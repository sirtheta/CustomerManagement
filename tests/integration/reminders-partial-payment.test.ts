import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Session } from "next-auth";
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
vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn(async () => Buffer.from("%PDF reminder")) }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(async () => undefined) }));

import { sendReminder } from "@/app/(app)/invoices/reminders/actions";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { deletePayment, recordPayment, recordRemainingPayment, syncInvoiceState } from "@/lib/payments";
import { checkOverdueInvoices } from "@/lib/reminders";
import { loadOpenInvoices } from "@/lib/import/queries";
import { loadAttentionCounts } from "@/lib/attention-counts";
import { allModulesEnabled } from "@/lib/modules";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;
const DAY = 86_400_000;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("reminding the remainder of a partially paid invoice", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "partial-reminder-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedInvoice(opts: { total?: number; state?: "Sent" | "Overdue"; dueInDays?: number; number?: string } = {}) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: opts.number ?? `I-${Math.floor(Math.random() * 1e8)}`,
        date: new Date(Date.now() - 40 * DAY),
        dueDate: new Date(Date.now() + (opts.dueInDays ?? -10) * DAY),
        totalAmount: opts.total ?? 1000,
        state: opts.state ?? "Overdue",
      },
    });
  }

  const reminderOf = (invoiceId: number) => db.prisma.pendingReminder.findUnique({ where: { invoiceId } });
  const stateOf = async (invoiceId: number) =>
    (await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).state;
  const pay = (invoiceId: number, amount: number) =>
    recordPayment({ invoiceId, amount, date: new Date(), source: "manual", actor }, db.prisma);
  const send = (reminderId: number) =>
    sendReminder({}, form({ reminderId: String(reminderId), to: "a@b.ch", subject: "M", body: "T" }));

  it("keeps the reminder with its level and snooze on a partial payment", async () => {
    const inv = await seedInvoice();
    const snoozedUntil = new Date(Date.now() + 5 * DAY);
    const created = await db.prisma.pendingReminder.create({
      data: { invoiceId: inv.id, reminderLevel: 3, snoozedUntil },
    });

    const { state } = await pay(inv.id, 400);

    expect(state).toBe("PartiallyPaid");
    const kept = await reminderOf(inv.id);
    expect(kept).toMatchObject({ id: created.id, reminderLevel: 3, snoozedUntil, createdAt: created.createdAt });
  });

  it("reminds the remainder after a partial payment and keeps counting the level", async () => {
    const inv = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 1 } });
    expect((await send(reminder.id)).success).toBe(true);

    await pay(inv.id, 400);
    // The cooldown of the first notice still applies; lift it to send the next level now.
    await db.prisma.pendingReminder.update({ where: { id: reminder.id }, data: { snoozedUntil: null } });

    expect((await send(reminder.id)).success).toBe(true);
    const docs = await db.prisma.sentDocument.findMany({ orderBy: { id: "asc" } });
    expect(docs.map((d) => [d.reminderLevel, d.openRappen])).toEqual([
      [1, 100000],
      [2, 60000],
    ]);
    expect(vi.mocked(generateReminderPdf).mock.calls[1][2]).toMatchObject({
      level: 2,
      openRappen: 60000,
      paidRappen: 40000,
      creditedRappen: 0,
      totalRappen: 60000,
    });
    expect((await reminderOf(inv.id))?.reminderLevel).toBe(3);
    expect(await stateOf(inv.id)).toBe("PartiallyPaid");
  });

  it("drops the reminder once the remainder is paid", async () => {
    const inv = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 2 } });
    await pay(inv.id, 400);
    expect(await reminderOf(inv.id)).not.toBeNull();

    const res = await recordRemainingPayment({ invoiceId: inv.id, date: new Date(), source: "manual", actor }, db.prisma);

    expect(res?.state).toBe("Paid");
    expect(await reminderOf(inv.id)).toBeNull();
  });

  it("drops the reminder when a credit note covers the remainder", async () => {
    const inv = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 2 } });
    await pay(inv.id, 400);
    await db.prisma.invoice.create({
      data: {
        customerId: inv.customerId, documentNumber: "I-CN-1", date: new Date(), dueDate: new Date(),
        totalAmount: -600, state: "Sent", creditNoteForId: inv.id,
      },
    });

    const { state } = await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);

    expect(state).toBe("Paid");
    expect(await reminderOf(inv.id)).toBeNull();
  });

  it("keeps the reminder when a credit note only lowers the remainder", async () => {
    const inv = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 2 } });
    await db.prisma.invoice.create({
      data: {
        customerId: inv.customerId, documentNumber: "I-CN-2", date: new Date(), dueDate: new Date(),
        totalAmount: -300, state: "Sent", creditNoteForId: inv.id,
      },
    });

    expect((await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma)).state).toBe("Overdue");
    expect((await reminderOf(inv.id))?.reminderLevel).toBe(2);
  });

  it("deleting a partial payment keeps the reminder, the invoice is Overdue again", async () => {
    const inv = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 2 } });
    const { paymentId } = await pay(inv.id, 400);

    expect((await deletePayment({ paymentId, actor }, db.prisma)).state).toBe("Overdue");
    expect((await reminderOf(inv.id))?.reminderLevel).toBe(2);
  });

  it("deleting the payment of a Paid overdue invoice offers the reminder again at once", async () => {
    const inv = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 3 } });
    const { paymentId } = await pay(inv.id, 1000);
    expect(await reminderOf(inv.id)).toBeNull();

    expect((await deletePayment({ paymentId, actor }, db.prisma)).state).toBe("Overdue");
    // A new reminder: the level starts again (counted from its creation).
    expect((await reminderOf(inv.id))?.reminderLevel).toBe(1);
  });

  it("deleting a payment of an invoice not yet due leaves it Sent without a reminder", async () => {
    const inv = await seedInvoice({ state: "Sent", dueInDays: 20 });
    const { paymentId } = await pay(inv.id, 400);
    expect(await reminderOf(inv.id)).toBeNull();

    expect((await deletePayment({ paymentId, actor }, db.prisma)).state).toBe("Sent");
    expect(await reminderOf(inv.id)).toBeNull();
  });

  it("a partial payment before the due date creates no reminder", async () => {
    const inv = await seedInvoice({ state: "Sent", dueInDays: 20 });
    await pay(inv.id, 400);
    await checkOverdueInvoices(db.prisma);
    expect(await reminderOf(inv.id)).toBeNull();
  });

  it("the daily job creates a reminder for an overdue PartiallyPaid invoice without one and leaves it PartiallyPaid", async () => {
    // Partially paid before the due date (or a reminder an older version deleted on the payment).
    const inv = await seedInvoice({ state: "Sent", dueInDays: 20 });
    await pay(inv.id, 400);
    await db.prisma.invoice.update({ where: { id: inv.id }, data: { dueDate: new Date(Date.now() - 3 * DAY) } });

    await checkOverdueInvoices(db.prisma);

    expect((await reminderOf(inv.id))?.reminderLevel).toBe(1);
    expect(await stateOf(inv.id)).toBe("PartiallyPaid");
  });

  it("the daily job keeps the reminder of a PartiallyPaid invoice and removes the one of a Paid invoice", async () => {
    const partial = await seedInvoice();
    const paid = await seedInvoice();
    await db.prisma.pendingReminder.create({ data: { invoiceId: partial.id, reminderLevel: 3 } });
    await db.prisma.pendingReminder.create({ data: { invoiceId: paid.id, reminderLevel: 2 } });
    await db.prisma.invoice.update({ where: { id: partial.id }, data: { state: "PartiallyPaid" } });
    await db.prisma.invoice.update({ where: { id: paid.id }, data: { state: "Paid" } });

    await checkOverdueInvoices(db.prisma);

    expect((await reminderOf(partial.id))?.reminderLevel).toBe(3);
    expect(await reminderOf(paid.id)).toBeNull();
  });

  it("the bank import accepts the reminder total sent for the remainder", async () => {
    await db.prisma.applicationSettings.updateMany({ data: { reminderFeeLevel2Rappen: 2000 } });
    const inv = await seedInvoice({ number: "I-26100077" });
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 2 } });
    await pay(inv.id, 400);
    expect((await send(reminder.id)).success).toBe(true);

    const open = (await loadOpenInvoices(db.prisma)).find((o) => o.id === inv.id);
    expect(open).toMatchObject({ openAmount: 600, reminderTotal: 620 });

    // Paying the notice total (remainder + fee) settles the invoice; the fee becomes an overpayment.
    await pay(inv.id, 620);
    expect(await stateOf(inv.id)).toBe("Paid");
    expect(await reminderOf(inv.id)).toBeNull();
  });

  it("the Viewer banner counts overdue PartiallyPaid invoices", async () => {
    await seedInvoice(); // Overdue
    const partial = await seedInvoice({ state: "Sent", dueInDays: -5 });
    await pay(partial.id, 100); // PartiallyPaid, past due
    const notDue = await seedInvoice({ state: "Sent", dueInDays: 10 });
    await pay(notDue.id, 100); // PartiallyPaid, not yet due

    const counts = await loadAttentionCounts(db.prisma, allModulesEnabled(), false);
    expect(counts.overdueInvoices).toBe(2);
  });
});
