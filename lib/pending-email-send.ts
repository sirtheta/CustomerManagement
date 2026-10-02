import { z } from "zod";
import prisma from "@/lib/prisma";
import type { Session } from "next-auth";
import { renderArchiveAndSend, recordSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import {
  acquireSendLock,
  invoiceSendLockKey,
  SEND_IN_PROGRESS_ERROR,
  CANCELED_INVOICE_SEND_ERROR,
} from "@/lib/send-lock";
import type { ArchiveResult } from "@/lib/document-archive";
import { assignDocumentNumber } from "@/lib/document-number";
import { fillDocumentNumber, fillTotalAmount } from "@/lib/document-display";
import { formatCurrency } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "pending-email-send" });

export const MAIL_SENT_NOT_RECORDED_ERROR =
  "Die E-Mail wurde bereits versendet, konnte aber nicht verbucht werden. Bitte nicht erneut freigeben, sondern den Entwurf prüfen und die Rechnung manuell als versendet markieren.";

/**
 * Sends the invoice behind a PendingEmail: assigns the number, renders and
 * archives the PDF, mails it and records the send. Shared by the manual
 * approval and the subscription job (autoSend). Uses the shared Prisma client.
 */
export async function sendPendingInvoice(input: {
  pendingId: number;
  to: string;
  subject: string;
  body: string;
  actor: Session;
}): Promise<{ error: string; mailSent?: true } | { invoiceId: number; documentNumber: string }> {
  const ref = await prisma.pendingEmail.findUnique({
    where: { id: input.pendingId },
    select: { invoiceId: true },
  });
  if (!ref) return { error: "Eintrag nicht gefunden." };

  const release = acquireSendLock(invoiceSendLockKey(ref.invoiceId));
  if (!release) return { error: SEND_IN_PROGRESS_ERROR };
  try {
    return await sendLocked(input);
  } finally {
    release();
  }
}

// Reads the entry again: it may be gone or its invoice sent by the time the lock is ours.
async function sendLocked(input: {
  pendingId: number;
  to: string;
  subject: string;
  body: string;
  actor: Session;
}): Promise<{ error: string; mailSent?: true } | { invoiceId: number; documentNumber: string }> {
  const { pendingId: id, to, subject, body, actor } = input;

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

  // Checked before the number is assigned, so a refused send does not use one up.
  if (pending.invoice.state === "Canceled") return { error: CANCELED_INVOICE_SEND_ERROR };
  if (pending.invoice.items.length === 0) {
    return { error: "Die Rechnung hat noch keine Positionen. Bitte zuerst Positionen eintragen." };
  }
  if (!z.string().email().safeParse(to).success) {
    return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  }

  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("invoice", pending.invoiceId, { actor });
  } catch (err) {
    log.error({ pendingId: id, err }, "sendPendingInvoice: number assignment failed");
    return { error: "Rechnungsnummer konnte nicht vergeben werden." };
  }
  const invoice = { ...pending.invoice, documentNumber };
  const total = formatCurrency(Number(pending.invoice.totalAmount));
  const finalSubject = fillTotalAmount(fillDocumentNumber(subject, documentNumber), total);
  const finalBody = fillTotalAmount(fillDocumentNumber(body, documentNumber), total);

  let archive: ArchiveResult;
  try {
    archive = await renderArchiveAndSend({
      invoice,
      settings,
      kind: "Invoice",
      mail: { to, subject: finalSubject, body: finalBody },
    });
  } catch (err) {
    log.error({ pendingId: id, to, err }, "sendPendingInvoice failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  const record = () =>
    prisma.$transaction([
      // Paid/PartiallyPaid/Canceled keep their state: it is derived from payments.
      prisma.invoice.updateMany({
        where: { id: pending.invoiceId, state: { in: ["Draft", "Sent", "Overdue"] } },
        data: { state: "Sent" },
      }),
      prisma.invoiceSentLog.create({
        data: { invoiceId: pending.invoiceId, sentTo: to, subject: finalSubject },
      }),
      prisma.pendingEmail.delete({ where: { id } }),
      prisma.sentDocument.create({
        data: sentDocumentData({
          invoiceId: pending.invoiceId,
          documentNumber,
          kind: "Invoice",
          archive,
          sentTo: to,
          subject: finalSubject,
          actor,
        }),
      }),
    ]);

  const recorded = await recordSend(record, {
    pendingId: id,
    invoiceId: pending.invoiceId,
    documentNumber,
    to,
    archivePath: archive.path,
    sha256: archive.sha256,
  });
  if (!recorded.ok) return { error: MAIL_SENT_NOT_RECORDED_ERROR, mailSent: true };
  const sentDocument = recorded.value[3];

  await logAudit(actor, "SEND", "Invoice", pending.invoiceId, documentNumber, {
    to,
    subject: finalSubject,
  });
  await auditArchived(actor, sentDocument, documentNumber, archive);

  return { invoiceId: pending.invoiceId, documentNumber };
}
