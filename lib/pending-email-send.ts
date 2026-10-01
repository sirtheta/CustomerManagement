import prisma from "@/lib/prisma";
import type { Session } from "next-auth";
import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
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
}): Promise<{ error: string; mailSent?: true } | { invoiceId: number }> {
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

  // The mail is out and cannot be recalled. A failing write here must never look
  // like an ordinary send failure, or an approval would mail the invoice a second
  // time: retry once (transient lock), then report mailSent with a warning.
  let sentDocument;
  try {
    try {
      [, , , sentDocument] = await record();
    } catch (firstErr) {
      log.warn({ pendingId: id, err: firstErr }, "Recording the send failed, retrying once");
      [, , , sentDocument] = await record();
    }
  } catch (err) {
    log.error(
      { pendingId: id, invoiceId: pending.invoiceId, documentNumber, to, archivePath: archive.path, sha256: archive.sha256, err },
      "Mail was sent but recording the send failed"
    );
    return { error: MAIL_SENT_NOT_RECORDED_ERROR, mailSent: true };
  }

  await logAudit(actor, "SEND", "Invoice", pending.invoiceId, documentNumber, {
    to,
    subject: finalSubject,
  });
  await auditArchived(actor, sentDocument, documentNumber, archive);

  return { invoiceId: pending.invoiceId };
}
