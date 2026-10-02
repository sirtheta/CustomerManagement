import type { PrismaClient } from "@prisma/client";
import { MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";

const DEFAULT_REMINDER_COOLDOWN_DAYS = 14;
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
