import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Every path that renders or mails an invoice, quote or reminder must load the selected sender
// profile; a loader without `senderProfile: true` would silently print the company data instead.
// Only PDF rendering and SMTP are mocked, the loaders run against a real database.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: vi.fn(async () => Buffer.from("pdf")),
  generateQuotePdf: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn(async () => Buffer.from("reminder-pdf")) }));
vi.mock("@/lib/email", () => ({
  sendInvoiceEmail: vi.fn(async () => {}),
  sendQuoteEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => ({ user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } })),
}));

import { sendDocument } from "@/lib/document-actions";
import { sendPendingInvoice } from "@/lib/pending-email-send";
import { sendReminder } from "@/app/(app)/invoices/reminders/actions";
import { checkSubscriptions } from "@/lib/subscriptions";
import { generateInvoicePdf, generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/email";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;
const profileName = (call: unknown[]) => (call[0] as { senderProfile?: { name: string } | null }).senderProfile?.name;

describe("selected sender profile reaches every render and send path", () => {
  const db = createTestDatabase();
  let dir: string;
  let customerId: number;
  let erika: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "sender-profile-send-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: { companyName: "Muster GmbH" } } } });
    customerId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
    erika = (await db.prisma.senderProfile.create({ data: { name: "Erika" } })).id;
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const items = { create: [{ name: "Beitrag", unit: "Piece" as const, unitPrice: 100, quantity: 1, totalAmount: 100 }] };

  const seedInvoice = (data: Record<string, unknown> = {}) =>
    db.prisma.invoice.create({
      data: {
        customerId,
        date: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: 100,
        state: "Draft",
        senderProfileId: erika,
        items,
        ...data,
      },
    });

  it("sendDocument renders and mails an invoice with the profile", async () => {
    const invoice = await seedInvoice();
    expect(await sendDocument({ kind: "invoice", id: invoice.id, to: "k@example.ch", subject: "s", body: "b", actor })).toEqual({ success: true });
    expect(profileName(vi.mocked(generateInvoicePdf).mock.calls[0])).toBe("Erika");
    expect(profileName(vi.mocked(sendInvoiceEmail).mock.calls[0])).toBe("Erika");
  });

  it("sendDocument renders and mails a quote with the profile", async () => {
    const quote = await db.prisma.quote.create({
      data: { customerId, date: new Date(), validUntil: new Date(), totalAmount: 100, state: "Draft", senderProfileId: erika, items },
    });
    expect(await sendDocument({ kind: "quote", id: quote.id, to: "k@example.ch", subject: "s", body: "b", actor })).toEqual({ success: true });
    expect(profileName(vi.mocked(generateQuotePdf).mock.calls[0])).toBe("Erika");
    expect(profileName(vi.mocked(sendQuoteEmail).mock.calls[0])).toBe("Erika");
  });

  it("sendPendingInvoice (approval and autoSend) renders and mails with the profile", async () => {
    const invoice = await seedInvoice();
    const pending = await db.prisma.pendingEmail.create({ data: { invoiceId: invoice.id, to: "k@example.ch", subject: "s", body: "b" } });
    const result = await sendPendingInvoice({ pendingId: pending.id, to: "k@example.ch", subject: "s", body: "b", actor });
    expect(result).toMatchObject({ invoiceId: invoice.id });
    expect(profileName(vi.mocked(generateInvoicePdf).mock.calls[0])).toBe("Erika");
    expect(profileName(vi.mocked(sendInvoiceEmail).mock.calls[0])).toBe("Erika");
  });

  it("sendReminder renders the Mahnbeleg and mails with the invoice's profile", async () => {
    const invoice = await seedInvoice({ state: "Overdue", documentNumber: "I-REM1" });
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 1 } });
    const fd = new FormData();
    fd.set("reminderId", String(reminder.id));
    fd.set("to", "k@example.ch");
    fd.set("subject", "s");
    fd.set("body", "b");
    expect(await sendReminder({}, fd)).toMatchObject({ success: true });
    expect(profileName(vi.mocked(generateReminderPdf).mock.calls[0])).toBe("Erika");
    expect(profileName(vi.mocked(sendInvoiceEmail).mock.calls[0])).toBe("Erika");
  });

  it("keeps {companyName} open in the queued subscription mail, so a profile chosen later still applies", async () => {
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "T", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] } },
    });
    await db.prisma.subscription.create({
      data: { customerId, templateId: template.id, interval: "Yearly", nextInvoiceDate: new Date(Date.now() - 86_400_000) },
    });

    await checkSubscriptions(db.prisma);

    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    expect(pending.subject).toContain("{companyName}");
    expect(pending.body).toContain("{companyName}");
    expect(pending.subject).not.toContain("Muster GmbH");
  });
});
