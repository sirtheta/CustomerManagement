"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { renderArchiveAndSend, recordSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import { acquireSendLock, invoiceSendLockKey, SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";
import type { ArchiveResult } from "@/lib/document-archive";
import { getPaymentSummary } from "@/lib/payments";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { computeReminderCharges, MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";
import { isLastReminderLevelSent, reminderSnoozedUntil } from "@/lib/reminders";
import { logAudit } from "@/lib/audit";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { requireModule } from "@/lib/module-guard";
import type { Session } from "next-auth";

const log = logger.child({ module: "invoices.reminders" });

const MAIL_SENT_NOT_RECORDED_ERROR =
  "Die Mahnung wurde bereits versendet, konnte aber nicht verbucht werden. Bitte nicht erneut senden, sondern die Rechnung prüfen.";

export async function sendReminder(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("reminders");

  const reminderId = parseInt(formData.get("reminderId") as string, 10);
  const to = (formData.get("to") as string).trim();
  const subject = (formData.get("subject") as string).trim();
  const body = (formData.get("body") as string).trim();

  const ref = await prisma.pendingReminder.findUnique({
    where: { id: reminderId },
    select: { invoiceId: true },
  });
  if (!ref) return { error: "Mahnung nicht gefunden." };

  const release = acquireSendLock(invoiceSendLockKey(ref.invoiceId));
  if (!release) return { error: SEND_IN_PROGRESS_ERROR, _ts: Date.now() };
  try {
    return await sendReminderLocked({ session, reminderId, to, subject, body });
  } finally {
    release();
  }
}

// Reads the reminder again: it may have been sent or removed by a payment by the time the lock is ours.
async function sendReminderLocked(input: {
  session: Session;
  reminderId: number;
  to: string;
  subject: string;
  body: string;
}): Promise<ActionState> {
  const { session, reminderId, to, subject, body } = input;

  const reminder = await prisma.pendingReminder.findUnique({
    where: { id: reminderId },
    include: {
      invoice: {
        include: { customer: true, items: { orderBy: { id: "asc" } } },
      },
    },
  });

  if (!reminder) return { error: "Mahnung nicht gefunden." };

  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  if (await isLastReminderLevelSent(prisma, reminder)) {
    return { error: "Die letzte Mahnstufe wurde bereits versendet." };
  }

  let archive: ArchiveResult;
  let charges: ReturnType<typeof computeReminderCharges>;
  try {
    // Open remainder after partial payments and sent credit notes, not the invoice total.
    const { remainingRappen, paidRappen, creditedRappen } = await getPaymentSummary(reminder.invoiceId);
    if (remainingRappen <= 0) return { error: "Die Rechnung ist bereits beglichen." };
    charges = computeReminderCharges({
      level: reminder.reminderLevel,
      openRappen: remainingRappen,
      paidRappen,
      creditedRappen,
      dueDate: reminder.invoice.dueDate,
      dunningDate: new Date(),
      settings,
    });
    archive = await renderArchiveAndSend({
      invoice: reminder.invoice,
      settings,
      kind: "Reminder",
      mail: { to, subject, body },
      renderPdf: () => generateReminderPdf(reminder.invoice, settings, charges),
      attachmentName: `mahnung-${reminder.invoice.documentNumber}-stufe${reminder.reminderLevel}.pdf`,
    });
  } catch (err) {
    log.error({ reminderId, to, err }, "sendReminder failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  const snoozedUntil = reminderSnoozedUntil(settings.reminderCooldownDays);

  const recorded = await recordSend(
    () =>
      prisma.$transaction([
        prisma.invoiceSentLog.create({
          data: { invoiceId: reminder.invoiceId, sentTo: to, subject },
        }),
        // updateMany: a payment may have removed the PendingReminder while the mail was going out,
        // and that must not roll back the booking of a notice that is already out.
        prisma.pendingReminder.updateMany({
          where: { id: reminderId },
          data: {
            reminderLevel: Math.min(reminder.reminderLevel + 1, MAX_REMINDER_LEVEL),
            snoozedUntil,
          },
        }),
        prisma.sentDocument.create({
          data: sentDocumentData({
            invoiceId: reminder.invoiceId,
            documentNumber: reminder.invoice.documentNumber!,
            kind: "Reminder",
            reminderLevel: reminder.reminderLevel,
            archive,
            sentTo: to,
            subject,
            actor: session,
            charges,
          }),
        }),
      ]),
    {
      reminderId,
      invoiceId: reminder.invoiceId,
      documentNumber: reminder.invoice.documentNumber,
      to,
      archivePath: archive.path,
      sha256: archive.sha256,
    }
  );
  if (!recorded.ok) return { error: MAIL_SENT_NOT_RECORDED_ERROR, _ts: Date.now() };
  const sentDocument = recorded.value[2];

  await logAudit(session, "SEND", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber ?? undefined, {
    to,
    level: reminder.reminderLevel,
    feeRappen: charges.feeRappen,
    interestRappen: charges.interestRappen,
  });
  await auditArchived(session, sentDocument, reminder.invoice.documentNumber!, archive);
  revalidatePath("/invoices/reminders");
  return { success: true, _ts: Date.now() };
}

export type DismissReminderResult = ActionState & {
  /** ISO time the reminder is hidden until; `undoDismissReminder` only resets exactly this snooze. */
  snoozedUntil?: string;
};

const REMINDER_GONE_ERROR = "Mahnung nicht gefunden. Sie wurde vermutlich durch eine Zahlung erledigt.";

export async function dismissReminder(id: number): Promise<DismissReminderResult> {
  const session = await requireEditor();
  await requireModule("reminders");
  const settings = await prisma.applicationSettings.findFirst({
    select: { reminderCooldownDays: true },
  });
  const snoozedUntil = reminderSnoozedUntil(settings?.reminderCooldownDays);
  const reminder = await prisma.pendingReminder.findUnique({
    where: { id },
    include: { invoice: { select: { id: true, documentNumber: true } } },
  });
  if (!reminder) return { error: REMINDER_GONE_ERROR };
  if (await isLastReminderLevelSent(prisma, reminder)) {
    return { error: "Die letzte Mahnstufe wurde bereits versendet. Zurückstellen ist nicht mehr nötig." };
  }
  // updateMany: a payment may have removed the reminder in the meantime.
  const { count } = await prisma.pendingReminder.updateMany({
    where: { id },
    data: { snoozedUntil },
  });
  if (count === 0) return { error: REMINDER_GONE_ERROR };
  await logAudit(session, "UPDATE", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber ?? undefined, {
    action: "dismissed",
    snoozedUntil: snoozedUntil.toISOString(),
  });
  revalidatePath("/invoices/reminders");
  return { success: true, snoozedUntil: snoozedUntil.toISOString() };
}

/**
 * Undo of "Zurückstellen": shows the reminder again at once. Only resets the
 * snooze `dismissReminder` set (same `snoozedUntil`), so it never cancels the
 * cooldown of a reminder that was sent in the meantime.
 */
export async function undoDismissReminder(id: number, snoozedUntil: string): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("reminders");
  const until = new Date(snoozedUntil);
  if (isNaN(until.getTime())) return { error: "Ungültige Anfrage." };
  const reminder = await prisma.pendingReminder.findUnique({
    where: { id },
    include: { invoice: { select: { id: true, documentNumber: true } } },
  });
  if (!reminder) return { error: REMINDER_GONE_ERROR };
  const { count } = await prisma.pendingReminder.updateMany({
    where: { id, snoozedUntil: until },
    data: { snoozedUntil: null },
  });
  if (count === 0) return { error: "Die Mahnung wurde inzwischen geändert und kann nicht mehr zurückgeholt werden." };
  await logAudit(session, "UPDATE", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber ?? undefined, {
    action: "dismissUndone",
  });
  revalidatePath("/invoices/reminders");
  return { success: true };
}
