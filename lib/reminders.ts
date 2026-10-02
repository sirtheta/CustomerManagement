import type { InvoiceState, PrismaClient } from "@prisma/client";
import { MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";

export const DEFAULT_REMINDER_COOLDOWN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export async function checkOverdueInvoices(prisma: PrismaClient): Promise<void> {
  // Safety net for state changes that bypass the actions (direct DB edits,
  // older code paths): reminders of invoices that are no longer Overdue are
  // stale and must not linger in the Mahnungen list.
  await prisma.pendingReminder.deleteMany({
    where: { invoice: { state: { not: "Overdue" } } },
  });

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      state: "Overdue",
      pendingReminder: null,
      creditNoteForId: null,
    },
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
  | { kind: "awaitingJob" }
  /** Overdue but partially paid: only `Overdue` invoices are reminded. */
  | { kind: "partiallyPaid" };

/**
 * Whether the invoice page can offer a reminder, and why not. Mirrors what the
 * Mahnungen list shows: a `PendingReminder` exists only for `Overdue` invoices
 * (created by the daily `checkOverdueInvoices`) and is hidden while snoozed.
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
  const pastDue = input.dueDate < now;
  if (input.state === "PartiallyPaid") return pastDue ? { kind: "partiallyPaid" } : { kind: "none" };
  if (input.state === "Sent") return pastDue ? { kind: "awaitingJob" } : { kind: "none" };
  if (input.state !== "Overdue") return { kind: "none" };

  const pending = input.pendingReminder;
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
