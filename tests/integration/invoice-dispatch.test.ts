import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The actions use the default prisma singleton; route it to the per-suite test DB.
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
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => ({
    user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" },
  })),
  requireAdmin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn(), generateQuotePdf: vi.fn() }));
vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn() }));

import { sendDocument } from "@/lib/document-actions";
import { approvePendingEmail } from "@/app/(app)/invoices/pending/actions";
import { sendReminder } from "@/app/(app)/invoices/reminders/actions";
import { verifyArchived, sha256Hex } from "@/lib/document-archive";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { sendInvoiceEmail } from "@/lib/email";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;
const pdf = Buffer.from("%PDF-1.4 integration bytes");
const ARCHIVE_ERROR = "PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("invoice send paths with real archive and database", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(pdf);
    vi.mocked(generateReminderPdf).mockResolvedValue(pdf);
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "dispatch-test-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedInvoice() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-26090001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Overdue",
      },
    });
  }

  /** Makes mkdir of the year folder fail on every platform (a file sits where the folder belongs). */
  function blockArchive() {
    writeFileSync(join(dir, String(new Date().getFullYear())), "not a directory");
  }

  async function expectArchivedAndAttached(kind: "Invoice" | "Reminder") {
    const rows = await db.prisma.sentDocument.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe(kind);
    const attached = vi.mocked(sendInvoiceEmail).mock.calls[0][2];
    expect(row.sha256).toBe(sha256Hex(attached));
    expect(readFileSync(join(dir, row.path))).toEqual(attached);
    expect((await verifyArchived(row)).ok).toBe(true);
    expect(await db.prisma.invoiceSentLog.count()).toBe(1);
    return row;
  }

  it("sendDocument archives the attached bytes and writes SentDocument and InvoiceSentLog", async () => {
    const invoice = await seedInvoice();

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result).toEqual({ success: true });
    await expectArchivedAndAttached("Invoice");
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).state).toBe("Sent");
  });

  it("approvePendingEmail archives, records and removes the pending e-mail", async () => {
    const invoice = await seedInvoice();
    await db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
    });
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();

    const result = await approvePendingEmail({}, form({ id: String(pending.id), to: "a@b.ch", subject: "s", body: "b" }));

    expect(result.success).toBe(true);
    await expectArchivedAndAttached("Invoice");
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("sendReminder archives with the reminder level at send time", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.success).toBe(true);
    const row = await expectArchivedAndAttached("Reminder");
    expect(row.reminderLevel).toBe(2);
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(3);
    expect(row.openRappen).toBe(10000);
    expect(row.feeRappen).toBe(0);
    expect(row.interestRappen).toBe(0);
    expect(row.dunningDate).not.toBeNull();
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("sendReminder stores fee and interest on the SentDocument", async () => {
    await db.prisma.applicationSettings.updateMany({
      data: { reminderFeeLevel2Rappen: 1000, reminderInterestPercent: 5 },
    });
    const invoice = await seedInvoice();
    await db.prisma.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: new Date(Date.now() - 73 * 86_400_000), totalAmount: 1000 },
    });
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.success).toBe(true);
    const row = await db.prisma.sentDocument.findFirstOrThrow();
    expect(row.openRappen).toBe(100000);
    expect(row.feeRappen).toBe(1000);
    expect(row.interestRappen).toBeGreaterThan(900); // 5 % x 73 Tage, +-1 Tag je nach Uhrzeit
    expect(row.interestRappen).toBeLessThan(1100);
    expect(Number(row.interestPercent)).toBe(5);
  });

  it("sendReminder stops after the last level and keeps level 4", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 4 } });

    const first = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(first.success).toBe(true);
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(4);

    const second = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(second.error).toBe("Die letzte Mahnstufe wurde bereits versendet.");
    expect(await db.prisma.sentDocument.count()).toBe(1);
  });

  it("sendReminder names the attachment after the level", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });
    await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toMatchObject({ attachmentName: "mahnung-I-26090001-stufe2.pdf" });
  });

  it("sendDocument sends nothing and changes nothing when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    blockArchive();

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(await db.prisma.sentDocument.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(0);
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).state).toBe("Overdue");
  });

  it("approvePendingEmail keeps the pending e-mail when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    const pending = await db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
    });
    blockArchive();

    const result = await approvePendingEmail({}, form({ id: String(pending.id), to: "a@b.ch", subject: "s", body: "b" }));

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(await db.prisma.sentDocument.count()).toBe(0);
  });

  it("sendReminder keeps the reminder level when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 1 } });
    blockArchive();

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(1);
    expect(await db.prisma.sentDocument.count()).toBe(0);
  });

  it("leaves an orphaned archive file but no DB row when sending fails after archiving", async () => {
    const invoice = await seedInvoice();
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error("SMTP down"));

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("SMTP down");
    expect(await db.prisma.sentDocument.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(0);
    expect(readdirSync(join(dir, String(new Date().getFullYear())))).toHaveLength(1);
  });
});
