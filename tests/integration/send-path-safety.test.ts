import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The three paths that mail an invoice PDF (sendDocument, sendPendingInvoice,
// sendReminder) share one failure model: once the mail is out, nothing may make
// the user (or a second caller) send it again, whatever happens to the booking.
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
import { sendInvoiceEmail } from "@/lib/email";
import { createCreditNoteDraft } from "@/lib/credit-notes";
import { SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("send paths after the mail went out", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.mocked(sendInvoiceEmail).mockReset().mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "send-safety-"));
    process.env.ARCHIVE_DIR = dir;
    const company = await db.prisma.companyInformation.create({ data: { companyName: "Test AG" } });
    await db.prisma.applicationSettings.create({ data: { companyInformationId: company.companyInformationId } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedInvoice(overrides: Record<string, unknown> = {}) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        date: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: 100,
        state: "Draft",
        ...overrides,
      },
    });
  }

  /** Makes the first `failures` calls of the array-form `$transaction` (the booking) reject. */
  function failRecording(failures: number) {
    const original = db.prisma.$transaction.bind(db.prisma) as (...a: unknown[]) => unknown;
    let calls = 0;
    vi.spyOn(db.prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
      if (Array.isArray(args[0])) {
        calls += 1;
        if (calls <= failures) return Promise.reject(new Error("SQLITE_BUSY"));
      }
      return original(...args);
    }) as never);
    return () => calls;
  }

  describe("sendDocument (invoice)", () => {
    const send = (id: number) =>
      sendDocument({ kind: "invoice", id, to: "kunde@example.ch", subject: "Rechnung", body: "Text", actor });

    it("retries the booking once and succeeds on a transient failure", async () => {
      const invoice = await seedInvoice();
      const calls = failRecording(1);

      expect(await send(invoice.id)).toEqual({ success: true });

      expect(calls()).toBe(2);
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).state).toBe("Sent");
      expect(await db.prisma.sentDocument.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it("answers with a do-not-resend error instead of throwing when the booking keeps failing", async () => {
      const invoice = await seedInvoice();
      const calls = failRecording(Infinity);

      const result = await send(invoice.id);

      expect(calls()).toBe(2);
      expect(result.success).toBeUndefined();
      expect(result.error).toContain("bereits versendet");
      expect(result.error).toContain("nicht erneut");
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    it("rejects a second send of the same invoice while the first is still in flight", async () => {
      const invoice = await seedInvoice();
      const gate = deferred();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => gate.promise);

      const first = send(invoice.id);
      await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
      expect(await send(invoice.id)).toEqual({ error: SEND_IN_PROGRESS_ERROR });

      gate.resolve();
      expect(await first).toEqual({ success: true });
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect(await db.prisma.sentDocument.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it("accepts a new send once the first one is done", async () => {
      const invoice = await seedInvoice();

      expect(await send(invoice.id)).toEqual({ success: true });
      expect(await send(invoice.id)).toEqual({ success: true });
    });

    it("removes the waiting PendingEmail of the invoice so it cannot be approved and mailed again", async () => {
      const invoice = await seedInvoice();
      await db.prisma.pendingEmail.create({
        data: { invoiceId: invoice.id, to: "kunde@example.ch", subject: "s", body: "b" },
      });

      expect(await send(invoice.id)).toEqual({ success: true });

      expect(await db.prisma.pendingEmail.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it("sends two credit notes against the same original one after the other, so the limit holds", async () => {
      const original = await seedInvoice({ state: "Sent", documentNumber: "I-ORIG" });
      const draftCredit = async (amount: number) => {
        const id = await createCreditNoteDraft(original.id, db.prisma);
        await db.prisma.invoice.update({ where: { id }, data: { totalAmount: -amount } });
        return id;
      };
      const [a, b] = [await draftCredit(60), await draftCredit(60)];
      const gate = deferred();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => gate.promise);

      const first = send(a);
      await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
      expect(await send(b)).toEqual({ error: SEND_IN_PROGRESS_ERROR });

      gate.resolve();
      expect(await first).toEqual({ success: true });
      // Once the first is booked, the second is checked against what is left.
      const second = await send(b);
      expect(second.error).toMatch(/übersteig/i);
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("sendPendingInvoice", () => {
    async function seedPending(invoiceOverrides: Record<string, unknown> = {}) {
      const invoice = await seedInvoice(invoiceOverrides);
      return db.prisma.pendingEmail.create({
        data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
      });
    }
    const input = (pendingId: number) => ({ pendingId, to: "a@b.ch", subject: "s", body: "b", actor });

    it("rejects a second approval while the first is still sending", async () => {
      const pending = await seedPending();
      const gate = deferred();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => gate.promise);

      const first = sendPendingInvoice(input(pending.id));
      await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
      expect(await sendPendingInvoice(input(pending.id))).toEqual({ error: SEND_IN_PROGRESS_ERROR });

      gate.resolve();
      expect(await first).toEqual({ invoiceId: pending.invoiceId });
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    it("blocks an approval while the same invoice is being sent directly", async () => {
      const pending = await seedPending();
      const gate = deferred();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => gate.promise);

      const direct = sendDocument({
        kind: "invoice",
        id: pending.invoiceId,
        to: "a@b.ch",
        subject: "s",
        body: "b",
        actor,
      });
      await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
      expect(await sendPendingInvoice(input(pending.id))).toEqual({ error: SEND_IN_PROGRESS_ERROR });

      gate.resolve();
      await direct;
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("sendReminder", () => {
    async function seedReminder() {
      const invoice = await seedInvoice({ state: "Overdue", documentNumber: "I-REM1" });
      const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 1 } });
      return { invoice, reminder };
    }

    const sendNotice = (reminderId: number) => {
      const formData = new FormData();
      formData.set("reminderId", String(reminderId));
      formData.set("to", "kunde@example.ch");
      formData.set("subject", "Zahlungserinnerung");
      formData.set("body", "Text");
      return sendReminder({}, formData);
    };

    it("books the notice and raises the level", async () => {
      const { invoice, reminder } = await seedReminder();

      expect(await sendNotice(reminder.id)).toMatchObject({ success: true });

      expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(2);
      expect(await db.prisma.sentDocument.count({ where: { invoiceId: invoice.id, kind: "Reminder" } })).toBe(1);
    });

    it("still books the notice when a payment removed the PendingReminder while the mail was going out", async () => {
      const { invoice, reminder } = await seedReminder();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => {
        await db.prisma.pendingReminder.deleteMany({ where: { invoiceId: invoice.id } });
      });

      expect(await sendNotice(reminder.id)).toMatchObject({ success: true });

      expect(await db.prisma.sentDocument.count({ where: { invoiceId: invoice.id, kind: "Reminder" } })).toBe(1);
      expect(await db.prisma.invoiceSentLog.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it("answers with a do-not-resend error instead of throwing when the booking keeps failing", async () => {
      const { reminder } = await seedReminder();
      const calls = failRecording(Infinity);

      const result = await sendNotice(reminder.id);

      expect(calls()).toBe(2);
      expect(result.success).toBeUndefined();
      expect(result.error).toContain("bereits versendet");
      expect(result.error).toContain("nicht erneut");
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    it("rejects a second send of the same reminder while the first is still in flight", async () => {
      const { reminder } = await seedReminder();
      const gate = deferred();
      vi.mocked(sendInvoiceEmail).mockImplementationOnce(async () => gate.promise);

      const first = sendNotice(reminder.id);
      await vi.waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
      expect(await sendNotice(reminder.id)).toMatchObject({ error: SEND_IN_PROGRESS_ERROR });

      gate.resolve();
      expect(await first).toMatchObject({ success: true });
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(2);
    });
  });
});
