"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { assignDocumentNumber } from "@/lib/document-number";
import { fillDocumentNumber } from "@/lib/document-display";
import type { ActionState } from "@/hooks/use-action-toast";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoices.pending" });

export async function approvePendingEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

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

  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("invoice", pending.invoiceId, { actor: session });
  } catch (err) {
    log.error({ pendingId: id, err }, "approvePendingEmail: number assignment failed");
    return { error: "Rechnungsnummer konnte nicht vergeben werden." };
  }
  const invoice = { ...pending.invoice, documentNumber };
  const finalSubject = fillDocumentNumber(subject, documentNumber);
  const finalBody = fillDocumentNumber(body, documentNumber);

  try {
    const pdf = await generateInvoicePdf(invoice, settings);
    await sendInvoiceEmail(invoice, settings, pdf, { to, subject: finalSubject, body: finalBody });
  } catch (err) {
    log.error({ pendingId: id, to, err }, "approvePendingEmail failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  await prisma.$transaction([
    // Paid/PartiallyPaid/Canceled keep their state: it is derived from payments.
    prisma.invoice.updateMany({
      where: { id: pending.invoiceId, state: { in: ["Draft", "Sent", "Overdue"] } },
      data: { state: "Sent" },
    }),
    prisma.invoiceSentLog.create({
      data: { invoiceId: pending.invoiceId, sentTo: to, subject: finalSubject },
    }),
    prisma.pendingEmail.delete({ where: { id } }),
  ]);

  await logAudit(session, "SEND", "Invoice", pending.invoiceId, documentNumber, {
    to,
    subject: finalSubject,
  });

  revalidatePath("/invoices/pending");
  revalidatePath(`/invoices/${pending.invoiceId}`);
  return { success: true, _ts: Date.now() };
}

export async function discardPendingEmail(id: number): Promise<void> {
  const session = await requireEditor();
  const discarded = await prisma.pendingEmail.delete({
    where: { id },
    include: { invoice: { select: { id: true, documentNumber: true } } },
  });
  await logAudit(session, "DELETE", "Invoice", discarded.invoice.id, discarded.invoice.documentNumber ?? undefined, {
    reason: "Pending-E-Mail verworfen",
  });
  revalidatePath("/invoices/pending");
}
