import type { InvoiceState, Prisma, PrismaClient } from "@prisma/client";
import { MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";
import { swissToday } from "@/lib/date";

export const DEFAULT_REMINDER_COOLDOWN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * States in which an invoice keeps its `PendingReminder`. A partial payment
 * leaves the invoice `PartiallyPaid` and the reminder (level, sent notices,
 * snooze) in place, so the remainder is reminded further. Paid, Canceled, Sent
 * and Draft drop it.
 */
export const REMINDER_STATES: readonly InvoiceState[] = ["Overdue", "PartiallyPaid"];

/** True when an invoice in this state with this open remainder keeps its reminder. */
export function keepsReminder(state: InvoiceState, remainingRappen: number): boolean {
  return remainingRappen > 0 && REMINDER_STATES.includes(state);
}

/**
 * Invoices that are overdue: `Overdue` (set by the daily job once the due date
 * passed, or by hand) and `PartiallyPaid` once the due date (a calendar day,
 * stored as UTC midnight) lies before today's Swiss day. PartiallyPaid stays
 * PartiallyPaid; its remainder is always > 0 (otherwise it would be Paid).
 * Credit notes never count. The daily job creates a reminder for exactly these,
 * and the overdue counts and the "Überfällig" filter use the same definition.
 */
export function overdueInvoiceWhere(today: Date = swissToday()): Prisma.InvoiceWhereInput {
  return {
    creditNoteForId: null,
    OR: [{ state: "Overdue" }, { state: "PartiallyPaid", dueDate: { lt: today } }],
  };
}

/**
 * Status filter of the invoice list and its CSV export: "Überfällig" means
 * overdue as defined above (so it also lists overdue PartiallyPaid invoices,
 * which keep their badge "Teilbezahlt"); every other value is the plain state.
 */
export function invoiceStateFilter(state: InvoiceState, today: Date = swissToday()): Prisma.InvoiceWhereInput {
  return state === "Overdue" ? overdueInvoiceWhere(today) : { state };
}

/** In-memory form of `overdueInvoiceWhere`. */
export function isOverdueInvoice(
  invoice: { state: InvoiceState; dueDate: Date; creditNoteForId: number | null },
  today: Date = swissToday()
): boolean {
  if (invoice.creditNoteForId != null) return false;
  if (invoice.state === "Overdue") return true;
  return invoice.state === "PartiallyPaid" && invoice.dueDate < today;
}

/**
 * When a reminder that was just sent or dismissed shows up again:
 * `cooldownDays` (`ApplicationSettings.reminderCooldownDays`, 14 without a
 * settings row) from now.
 */
export function reminderSnoozedUntil(
  cooldownDays: number | null | undefined,
  now: Date = new Date()
): Date {
  return new Date(now.getTime() + (cooldownDays ?? DEFAULT_REMINDER_COOLDOWN_DAYS) * DAY_MS);
}

export async function checkOverdueInvoices(prisma: PrismaClient, today: Date = swissToday()): Promise<void> {
  // Safety net for state changes that bypass the actions (direct DB edits,
  // older code paths): reminders of invoices that are neither Overdue nor
  // PartiallyPaid are stale and must not linger in the Mahnungen list. Same for
  // invoices with a total of 0: nothing is open, `sendReminder` refuses them.
  // (Invoices settled by payments or credit notes leave Overdue/PartiallyPaid
  // in `recalculateInvoiceState`, which drops their reminder.)
  await prisma.pendingReminder.deleteMany({
    where: {
      OR: [
        { invoice: { state: { notIn: [...REMINDER_STATES] } } },
        { invoice: { totalAmount: { lte: 0 } } },
      ],
    },
  });

  // Also picks up PartiallyPaid invoices that became overdue after the partial
  // payment, or whose reminder an older version deleted on the payment.
  const overdueInvoices = await prisma.invoice.findMany({
    where: { AND: [overdueInvoiceWhere(today), { totalAmount: { gt: 0 } }, { pendingReminder: null }] },
    select: { id: true },
  });

  if (overdueInvoices.length === 0) return;

  await prisma.pendingReminder.createMany({
    data: overdueInvoices.map((inv) => ({ invoiceId: inv.id })),
  });
}

/**
 * True once the last level (4) has been sent for this reminder. Counted from the
 * reminder's creation on, so a reminder that restarts after a reset (payment
 * deleted, status back to Sent) is not blocked by an older level-4 notice.
 */
export async function isLastReminderLevelSent(
  prisma: PrismaClient,
  reminder: { invoiceId: number; reminderLevel: number; createdAt: Date }
): Promise<boolean> {
  if (reminder.reminderLevel > MAX_REMINDER_LEVEL) return true;
  if (reminder.reminderLevel < MAX_REMINDER_LEVEL) return false;
  const sent = await prisma.sentDocument.count({
    where: {
      invoiceId: reminder.invoiceId,
      kind: "Reminder",
      reminderLevel: MAX_REMINDER_LEVEL,
      createdAt: { gte: reminder.createdAt },
    },
  });
  return sent > 0;
}

/**
 * Batch form of `isLastReminderLevelSent`: the ids of the given reminders whose
 * last level went out (one query for all of them). Such a reminder stays in the
 * Mahnungen list, but nothing can be sent for it any more.
 */
export async function lastLevelSentReminderIds(
  prisma: Pick<PrismaClient, "sentDocument">,
  reminders: { id: number; invoiceId: number; reminderLevel: number; createdAt: Date }[]
): Promise<Set<number>> {
  const result = new Set<number>();
  const atLast: typeof reminders = [];
  for (const r of reminders) {
    if (r.reminderLevel > MAX_REMINDER_LEVEL) result.add(r.id);
    else if (r.reminderLevel === MAX_REMINDER_LEVEL) atLast.push(r);
  }
  if (atLast.length === 0) return result;
  const docs = await prisma.sentDocument.findMany({
    where: { kind: "Reminder", reminderLevel: MAX_REMINDER_LEVEL, invoiceId: { in: atLast.map((r) => r.invoiceId) } },
    select: { invoiceId: true, createdAt: true },
  });
  for (const r of atLast) {
    if (docs.some((d) => d.invoiceId === r.invoiceId && d.createdAt >= r.createdAt)) result.add(r.id);
  }
  return result;
}

export type ReminderAvailability =
  /** Nothing to remind (draft, paid, canceled, credit note, not yet due). */
  | { kind: "none" }
  /** Listed under Mahnungen and can be sent now. */
  | { kind: "available"; level: number }
  /** Sent or put back recently: hidden from the list until `until`. */
  | { kind: "snoozed"; level: number; until: Date }
  /** Level 4 went out; the app sends nothing further. */
  | { kind: "lastLevelSent" }
  /** Due date passed, but the daily job has not created the reminder yet. */
  | { kind: "awaitingJob" };

/**
 * Whether the invoice page can offer a reminder, and why not. Mirrors what the
 * Mahnungen list shows: a `PendingReminder` exists only for `Overdue` and
 * overdue `PartiallyPaid` invoices (created by the daily `checkOverdueInvoices`)
 * and is hidden while snoozed.
 */
export function reminderAvailability(input: {
  state: InvoiceState;
  dueDate: Date;
  isCreditNote: boolean;
  pendingReminder: { reminderLevel: number; snoozedUntil: Date | null } | null;
  lastLevelSent: boolean;
  now?: Date;
}): ReminderAvailability {
  const now = input.now ?? new Date();
  if (input.isCreditNote) return { kind: "none" };
  const pending = input.pendingReminder;
  if (input.state === "Sent") return input.dueDate < now ? { kind: "awaitingJob" } : { kind: "none" };
  if (input.state === "PartiallyPaid") {
    // Same cut-off as the daily job (`overdueInvoiceWhere`): the due day lies before today's Swiss day.
    if (!pending) return input.dueDate < swissToday(now) ? { kind: "awaitingJob" } : { kind: "none" };
  } else if (input.state !== "Overdue") {
    return { kind: "none" };
  }

  if (!pending) return { kind: "awaitingJob" };
  if (input.lastLevelSent) return { kind: "lastLevelSent" };
  if (pending.snoozedUntil && pending.snoozedUntil > now) {
    return { kind: "snoozed", level: pending.reminderLevel, until: pending.snoozedUntil };
  }
  return { kind: "available", level: pending.reminderLevel };
}

export type SentReminderInfo = { level: number; sentAt: Date };

/**
 * The newest reminder notice per invoice, counted like `isLastReminderLevelSent`
 * from the reminder's creation on (a restarted reminder begins without one).
 * Read from `SentDocument`, which every sent reminder gets.
 */
export async function latestSentReminders(
  prisma: PrismaClient,
  reminders: { invoiceId: number; createdAt: Date }[]
): Promise<Map<number, SentReminderInfo>> {
  const result = new Map<number, SentReminderInfo>();
  if (reminders.length === 0) return result;
  const since = new Map(reminders.map((r) => [r.invoiceId, r.createdAt]));
  const docs = await prisma.sentDocument.findMany({
    where: { kind: "Reminder", invoiceId: { in: [...since.keys()] } },
    select: { invoiceId: true, reminderLevel: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const doc of docs) {
    if (result.has(doc.invoiceId)) continue;
    if (doc.createdAt < since.get(doc.invoiceId)!) continue;
    result.set(doc.invoiceId, { level: doc.reminderLevel ?? 1, sentAt: doc.createdAt });
  }
  return result;
}
