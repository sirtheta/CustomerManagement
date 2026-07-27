"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoices.reminders" });

export async function sendReminder(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const reminderId = parseInt(formData.get("reminderId") as string, 10);
  const to = (formData.get("to") as string).trim();
  const subject = (formData.get("subject") as string).trim();
  const body = (formData.get("body") as string).trim();

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

  try {
    const pdf = await generateInvoicePdf(reminder.invoice, settings);
    await sendInvoiceEmail(reminder.invoice, settings, pdf, { to, subject, body });
  } catch (err) {
    log.error({ reminderId, to, err }, "sendReminder failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  const cooldownDays = settings.reminderCooldownDays ?? 14;
  const snoozedUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.invoiceSentLog.create({
      data: { invoiceId: reminder.invoiceId, sentTo: to, subject },
    }),
    prisma.pendingReminder.update({
      where: { id: reminderId },
      data: {
        reminderLevel: reminder.reminderLevel + 1,
        snoozedUntil,
      },
    }),
  ]);

  await logAudit(session, "SEND", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber, {
    to,
    level: reminder.reminderLevel,
  });
  revalidatePath("/invoices/reminders");
  return { success: true, _ts: Date.now() };
}

export async function dismissReminder(id: number): Promise<void> {
  const session = await requireEditor();
  const settings = await prisma.applicationSettings.findFirst({
    select: { reminderCooldownDays: true },
  });
  const cooldownDays = settings?.reminderCooldownDays ?? 14;
  const snoozedUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
  const reminder = await prisma.pendingReminder.findUnique({
    where: { id },
    include: { invoice: { select: { id: true, documentNumber: true } } },
  });
  await prisma.pendingReminder.update({
    where: { id },
    data: { snoozedUntil },
  });
  if (reminder) {
    await logAudit(session, "UPDATE", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber, {
      action: "dismissed",
    });
  }
  revalidatePath("/invoices/reminders");
}
