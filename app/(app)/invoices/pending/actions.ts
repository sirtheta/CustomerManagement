"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoices.pending" });

export async function approvePendingEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireEditor();

  const id = parseInt(formData.get("id") as string, 10);
  const to = (formData.get("to") as string).trim();
  const subject = (formData.get("subject") as string).trim();
  const body = (formData.get("body") as string).trim();

  const pending = await prisma.pendingEmail.findUnique({
    where: { id },
    include: {
      invoice: {
        include: { customer: true, items: { orderBy: { id: "asc" } } },
      },
    },
  });

  if (!pending) return { error: "Eintrag nicht gefunden." };

  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  try {
    const pdf = await generateInvoicePdf(pending.invoice, settings);
    await sendInvoiceEmail(pending.invoice, settings, pdf, { to, subject, body });
  } catch (err) {
    log.error({ pendingId: id, to, err }, "approvePendingEmail failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: pending.invoiceId },
      data: { state: "Sent" },
    }),
    prisma.invoiceSentLog.create({
      data: { invoiceId: pending.invoiceId, sentTo: to, subject },
    }),
    prisma.pendingEmail.delete({ where: { id } }),
  ]);

  revalidatePath("/invoices/pending");
  revalidatePath(`/invoices/${pending.invoiceId}`);
  return { success: true, _ts: Date.now() };
}

export async function discardPendingEmail(id: number): Promise<void> {
  await requireEditor();
  await prisma.pendingEmail.delete({ where: { id } });
  revalidatePath("/invoices/pending");
}
