import defaultPrisma from "@/lib/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { assignDocumentNumber } from "@/lib/document-number";
import { fillDocumentNumber } from "@/lib/document-display";
import type { DocumentKind } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { saveItemsToCatalog } from "@/lib/service-catalog";
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendQuoteEmail } from "@/lib/email";
import { renderArchiveAndSend, recordSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import { acquireSendLock, invoiceSendLockKey, SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";
import type { ArchiveResult } from "@/lib/document-archive";
import { CreditNoteError, assertCreditWithinOriginal } from "@/lib/credit-notes";
import { syncInvoiceState } from "@/lib/payments";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";
import { createQuoteFollowUp } from "@/lib/tasks";

const log = logger.child({ module: "document-actions" });

const MAIL_SENT_NOT_RECORDED_ERROR =
  "Die E-Mail wurde bereits versendet, konnte aber nicht verbucht werden. Bitte nicht erneut senden, sondern die Rechnung prüfen und manuell als versendet markieren.";

/**
 * Shared by `app/(app)/invoices/actions.ts` and `app/(app)/quotes/actions.ts`,
 * which are otherwise near-identical (same transaction/send/audit shape) —
 * see review finding #10. Branching on `kind` instead of a Prisma generic
 * keeps each side's `data` object plainly typed against its own delegate.
 */
async function createItems(
  tx: Prisma.TransactionClient,
  kind: DocumentKind,
  documentId: number,
  items: ItemData[]
) {
  if (items.length === 0) return;
  await tx.item.createMany({
    data: items.map((item) => ({
      ...(kind === "invoice" ? { invoiceId: documentId } : { quoteId: documentId }),
      name: item.name,
      description: item.description || null,
      unit: item.unit,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discountPercent: item.discountPercent,
      totalAmount: item.totalAmount,
      customText: item.customText || null,
      categoryId: item.categoryId,
    })),
  });
}

/** Fields of an invoice/quote as entered in the form; used for create and update. */
export type DocumentInput = {
  kind: DocumentKind;
  customerId: number;
  customUserText: string | null;
  date: Date;
  dueDate?: Date;
  validUntil?: Date;
  totalAmount: number;
  discountPercent: number;
  items: ItemData[];
};

export async function createDocumentWithItems(
  input: DocumentInput
): Promise<{ id: number; documentNumber: null }> {
  // Drafts are created without a number; assignDocumentNumber hands it out
  // when the document first leaves Draft.
  const id = await defaultPrisma.$transaction(async (tx) => {
    let documentId: number;
    if (input.kind === "invoice") {
      const invoice = await tx.invoice.create({
        data: {
          customerId: input.customerId,
          customUserText: input.customUserText,
          date: input.date,
          dueDate: input.dueDate!,
          totalAmount: input.totalAmount,
          discountPercent: input.discountPercent,
          state: "Draft",
        },
      });
      documentId = invoice.id;
    } else {
      const quote = await tx.quote.create({
        data: {
          customerId: input.customerId,
          customUserText: input.customUserText,
          date: input.date,
          validUntil: input.validUntil!,
          totalAmount: input.totalAmount,
          discountPercent: input.discountPercent,
          state: "Draft",
        },
      });
      documentId = quote.id;
    }

    await saveItemsToCatalog(tx, input.items);
    await createItems(tx, input.kind, documentId, input.items);
    return documentId;
  });

  return { id, documentNumber: null };
}

/** Thrown when someone tries to edit an invoice that already left Draft. */
export class DocumentLockedError extends Error {}

export async function updateDocumentWithItems(
  id: number,
  input: DocumentInput,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (input.kind === "invoice") {
      const current = await tx.invoice.findUnique({ where: { id }, select: { state: true } });
      if (!current) throw new Error("Rechnung nicht gefunden.");
      if (current.state !== "Draft") {
        throw new DocumentLockedError(
          "Versendete Rechnungen können nicht mehr bearbeitet werden. Bitte eine Gutschrift erstellen."
        );
      }
      await tx.item.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id },
        data: {
          customerId: input.customerId,
          customUserText: input.customUserText,
          date: input.date,
          dueDate: input.dueDate!,
          totalAmount: input.totalAmount,
          discountPercent: input.discountPercent,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.item.deleteMany({ where: { quoteId: id } });
      await tx.quote.update({
        where: { id },
        data: {
          customerId: input.customerId,
          customUserText: input.customUserText,
          date: input.date,
          validUntil: input.validUntil!,
          totalAmount: input.totalAmount,
          discountPercent: input.discountPercent,
          version: { increment: 1 },
        },
      });
    }

    await saveItemsToCatalog(tx, input.items);
    await createItems(tx, input.kind, id, input.items);
  });
}

export type SendDocumentInput = {
  kind: DocumentKind;
  id: number;
  to: string;
  subject: string;
  body: string;
  actor: Session;
};

export type SendDocumentResult = { error?: string; success?: true };

export async function sendDocument(input: SendDocumentInput): Promise<SendDocumentResult> {
  const settings = await defaultPrisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  if (input.kind === "invoice") return sendInvoice(input, settings);

  const quote = await defaultPrisma.quote.findUnique({
    where: { id: input.id },
    include: { customer: true, items: { orderBy: { id: "asc" } } },
  });
  if (!quote) return { error: "Offerte nicht gefunden." };

  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("quote", input.id, { actor: input.actor });
  } catch (err) {
    log.error({ quoteId: input.id, err }, "sendDocument (quote): number assignment failed");
    return { error: "Offertennummer konnte nicht vergeben werden." };
  }
  const numbered = { ...quote, documentNumber };
  const subject = fillDocumentNumber(input.subject, documentNumber);
  const body = fillDocumentNumber(input.body, documentNumber);

  try {
    const pdf = await generateQuotePdf(numbered, settings);
    await sendQuoteEmail(numbered, settings, pdf, {
      to: input.to,
      subject,
      body,
    });
  } catch (err) {
    log.error({ quoteId: input.id, to: input.to, err }, "sendDocument (quote) failed");
    return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
  }

  await defaultPrisma.$transaction([
    defaultPrisma.quote.update({ where: { id: input.id }, data: { state: "Sent" } }),
    defaultPrisma.quoteSentLog.create({
      data: { quoteId: input.id, sentTo: input.to, subject },
    }),
  ]);
  await logAudit(input.actor, "SEND", "Quote", input.id, documentNumber, {
    to: input.to,
  });
  await createQuoteFollowUp(defaultPrisma, {
    quoteId: input.id,
    assigneeId: parseInt(input.actor.user.id, 10),
  });
  revalidatePath(`/quotes/${input.id}`);

  return { success: true };
}

type DispatchSettings = Parameters<typeof renderArchiveAndSend>[0]["settings"];

async function sendInvoice(input: SendDocumentInput, settings: DispatchSettings): Promise<SendDocumentResult> {
  // A credit note locks its original: checking the credit limit and booking two
  // credit notes against the same invoice must not interleave.
  const ref = await defaultPrisma.invoice.findUnique({
    where: { id: input.id },
    select: { creditNoteForId: true },
  });
  if (!ref) return { error: "Rechnung nicht gefunden." };

  const release = acquireSendLock(invoiceSendLockKey(ref.creditNoteForId ?? input.id));
  if (!release) return { error: SEND_IN_PROGRESS_ERROR };
  try {
    return await sendInvoiceLocked(input, settings);
  } finally {
    release();
  }
}

async function sendInvoiceLocked(input: SendDocumentInput, settings: DispatchSettings): Promise<SendDocumentResult> {
  const invoice = await defaultPrisma.invoice.findUnique({
    where: { id: input.id },
    include: {
      customer: true,
      items: { orderBy: { id: "asc" } },
      creditNoteFor: { select: { documentNumber: true } },
    },
  });
  if (!invoice) return { error: "Rechnung nicht gefunden." };

  // Drafts are not counted when a credit note is saved, so this is the real
  // enforcement of the credit limit. It must run before a number is assigned.
  if (invoice.creditNoteForId != null) {
    try {
      await assertCreditWithinOriginal(defaultPrisma, {
        id: invoice.id,
        creditNoteForId: invoice.creditNoteForId,
        totalAmount: invoice.totalAmount,
      });
    } catch (err) {
      if (err instanceof CreditNoteError) return { error: err.message };
      throw err;
    }
  }

  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("invoice", input.id, { actor: input.actor });
  } catch (err) {
    log.error({ invoiceId: input.id, err }, "sendDocument (invoice): number assignment failed");
    return { error: "Rechnungsnummer konnte nicht vergeben werden." };
  }
  const numbered = { ...invoice, documentNumber };
  const subject = fillDocumentNumber(input.subject, documentNumber);
  const body = fillDocumentNumber(input.body, documentNumber);

  let archive: ArchiveResult;
  try {
    archive = await renderArchiveAndSend({
      invoice: numbered,
      settings,
      kind: "Invoice",
      mail: { to: input.to, subject, body },
    });
  } catch (err) {
    log.error({ invoiceId: input.id, to: input.to, err }, "sendDocument (invoice) failed");
    return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
  }

  const recorded = await recordSend(
    () =>
      defaultPrisma.$transaction([
        // Paid/PartiallyPaid/Canceled keep their state: it is derived from payments.
        defaultPrisma.invoice.updateMany({
          where: { id: input.id, state: { in: ["Draft", "Sent", "Overdue"] } },
          data: { state: "Sent" },
        }),
        defaultPrisma.invoiceSentLog.create({
          data: { invoiceId: input.id, sentTo: input.to, subject },
        }),
        defaultPrisma.sentDocument.create({
          data: sentDocumentData({
            invoiceId: input.id,
            documentNumber,
            kind: "Invoice",
            archive,
            sentTo: input.to,
            subject,
            actor: input.actor,
          }),
        }),
        // A subscription draft waiting for approval is now sent; approving it later would mail it twice.
        defaultPrisma.pendingEmail.deleteMany({ where: { invoiceId: input.id } }),
      ]),
    {
      invoiceId: input.id,
      documentNumber,
      to: input.to,
      archivePath: archive.path,
      sha256: archive.sha256,
    }
  );
  if (!recorded.ok) return { error: MAIL_SENT_NOT_RECORDED_ERROR };
  const sentDocument = recorded.value[2];
  await logAudit(input.actor, "SEND", "Invoice", input.id, documentNumber, {
    to: input.to,
    ...(invoice.creditNoteForId != null ? { creditNoteFor: invoice.creditNoteForId } : {}),
  });
  await auditArchived(input.actor, sentDocument, documentNumber, archive);
  if (invoice.creditNoteForId != null) {
    await syncInvoiceState({ invoiceId: invoice.creditNoteForId, actor: input.actor, source: "credit-note" });
    revalidatePath(`/invoices/${invoice.creditNoteForId}`);
    revalidatePath("/accounting/receivables");
    revalidatePath("/dashboard");
  }
  revalidatePath(`/invoices/${input.id}`);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  return { success: true };
}
