import type { ApplicationSettings, CompanyInformation, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { generateInvoicePdf, type InvoiceWithDetails } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { archivePdf, type ArchiveKind, type ArchiveResult } from "@/lib/document-archive";
import type { ReminderCharges } from "@/lib/reminder-charges";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoice-dispatch" });

export type DispatchSettings = ApplicationSettings & { companyInfo: CompanyInformation };

/**
 * Shared by every path that mails an invoice PDF (send, approve pending e-mail,
 * reminder): render once, archive those exact bytes, then attach the same bytes.
 * If archiving fails nothing is sent, so there is never a sent document without
 * an archive copy. PDF and mail errors pass through unchanged for the callers.
 */
export async function renderArchiveAndSend(params: {
  invoice: InvoiceWithDetails;
  settings: DispatchSettings;
  kind: ArchiveKind;
  mail: { to: string; subject: string; body: string };
  /** Replaces the default invoice rendering (reminders pass the Mahnbeleg renderer). */
  renderPdf?: () => Promise<Buffer>;
  /** Attachment file name; defaults to the invoice naming in `sendInvoiceEmail`. */
  attachmentName?: string;
}): Promise<ArchiveResult> {
  const { invoice, settings, kind, mail, renderPdf, attachmentName } = params;
  if (!invoice.documentNumber) throw new Error("Rechnung hat noch keine Nummer.");

  const pdf = renderPdf ? await renderPdf() : await generateInvoicePdf(invoice, settings);

  let archive: ArchiveResult;
  try {
    archive = await archivePdf({ documentNumber: invoice.documentNumber, kind, pdf });
  } catch (err) {
    log.error({ invoiceId: invoice.id, kind, err }, "Archiving the PDF failed, not sending");
    throw new Error("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
  }

  await sendInvoiceEmail(invoice, settings, pdf, attachmentName ? { ...mail, attachmentName } : mail);
  return archive;
}

/**
 * Books a send that already went out. The mail cannot be recalled, so a failing
 * write must never look like an ordinary send failure (the user would just send
 * again): retry once (transient lock), then report `ok: false` for the caller to
 * turn into a "do not resend" message.
 */
export async function recordSend<T>(
  record: () => Promise<T>,
  context: Record<string, unknown>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    try {
      return { ok: true, value: await record() };
    } catch (firstErr) {
      log.warn({ ...context, err: firstErr }, "Recording the send failed, retrying once");
      return { ok: true, value: await record() };
    }
  } catch (err) {
    log.error({ ...context, err }, "Mail was sent but recording the send failed");
    return { ok: false };
  }
}

/** Create input for the `SentDocument` row that callers add to their existing send transaction. */
export function sentDocumentData(params: {
  invoiceId: number;
  documentNumber: string;
  kind: ArchiveKind;
  reminderLevel?: number;
  archive: ArchiveResult;
  sentTo: string;
  subject: string;
  actor: Session;
  charges?: ReminderCharges;
}): Prisma.SentDocumentUncheckedCreateInput {
  return {
    invoiceId: params.invoiceId,
    kind: params.kind,
    reminderLevel: params.reminderLevel ?? null,
    documentNumber: params.documentNumber,
    path: params.archive.path,
    sha256: params.archive.sha256,
    size: params.archive.size,
    sentTo: params.sentTo,
    subject: params.subject,
    createdById: parseInt(params.actor.user.id, 10),
    ...(params.charges
      ? {
          openRappen: params.charges.openRappen,
          feeRappen: params.charges.feeRappen,
          interestRappen: params.charges.interestRappen,
          interestPercent: params.charges.interestPercent,
          dunningDate: params.charges.dunningDate,
        }
      : {}),
  };
}

export async function auditArchived(
  actor: Session,
  sent: { id: number },
  documentNumber: string,
  archive: ArchiveResult
): Promise<void> {
  await logAudit(actor, "CREATE", "SentDocument", sent.id, documentNumber, {
    sha256: archive.sha256,
    path: archive.path,
  });
}
