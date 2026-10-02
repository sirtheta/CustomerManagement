import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import { documentLabel } from "@/lib/document-display";
import { isModuleEnabled } from "@/lib/modules";

const log = logger.child({ module: "tasks" });

export const QUOTE_FOLLOW_UP_DAYS = 7;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Creates the "Offerte nachfassen" task for a quote that was just sent, due
 * `QUOTE_FOLLOW_UP_DAYS` after the send date. A quote that already has an open
 * follow-up (sent twice in a row) does not get a second one. Never throws: a
 * missing task must not turn a successful send into an error.
 */
export async function createQuoteFollowUp(
  prisma: PrismaClient,
  input: { quoteId: number; assigneeId?: number | null; sentAt?: Date }
): Promise<void> {
  try {
    if (!(await isModuleEnabled(prisma, "tasks"))) return;
    const quote = await prisma.quote.findUnique({
      where: { id: input.quoteId },
      select: { id: true, customerId: true, documentNumber: true },
    });
    if (!quote) return;
    const open = await prisma.task.findFirst({
      where: { quoteId: quote.id, doneAt: null },
      select: { id: true },
    });
    if (open) return;
    const due = startOfDay(input.sentAt ?? new Date());
    due.setDate(due.getDate() + QUOTE_FOLLOW_UP_DAYS);
    await prisma.task.create({
      data: {
        customerId: quote.customerId,
        quoteId: quote.id,
        title: `Offerte ${documentLabel(quote.documentNumber)} nachfassen`,
        dueDate: due,
        assigneeId: Number.isInteger(input.assigneeId) ? input.assigneeId : null,
      },
    });
  } catch (err) {
    log.error({ err, quoteId: input.quoteId }, "Creating the quote follow-up task failed");
  }
}

/**
 * Completes open follow-up tasks whose quote has been answered (anything but
 * `Sent`), so nobody is reminded to chase a quote that was accepted, declined
 * or has expired. Returns the number of tasks closed.
 */
export async function closeAnsweredFollowUps(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.task.updateMany({
    where: { doneAt: null, quoteId: { not: null }, quote: { state: { not: "Sent" } } },
    data: { doneAt: new Date() },
  });
  return count;
}

/**
 * Tells the admin channels about open tasks that are due and were not
 * announced yet (one message for all of them). They are stamped only when at
 * least one channel delivered: with no channel configured, or when every
 * delivery failed, they stay unannounced and are tried again on the next run.
 */
export async function notifyDueTasks(
  prisma: PrismaClient,
  settings: Parameters<typeof import("@/lib/notifications").notifyAdmins>[0] | null,
  now: Date = new Date()
): Promise<void> {
  if (!settings) return;
  const due = await prisma.task.findMany({
    where: { doneAt: null, notifiedAt: null, dueDate: { lte: now } },
    select: { id: true },
  });
  if (due.length === 0) return;
  const { notifyAdmins } = await import("@/lib/notifications");
  const delivered = await notifyAdmins(
    settings,
    `Fällige Aufgaben – ${due.length} Aufgabe(n)`,
    `${due.length} Aufgabe(n) sind fällig.`,
    "/dashboard"
  );
  if (!delivered) return;
  await prisma.task.updateMany({
    where: { id: { in: due.map((t) => t.id) } },
    data: { notifiedAt: now },
  });
}
