"use server";

import { effectivePaymentTermDays } from "@/lib/customer-billing";
import { assertCustomerActive, CUSTOMER_ARCHIVED_ERROR } from "@/lib/customer-archive";
import { resolveSenderProfileId } from "@/lib/sender-profile";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { QuoteState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { assignDocumentNumber } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import { DocumentItemsError } from "@/lib/document-items-error";
import { loadTotalOptions } from "@/lib/total-options";
import { logAudit } from "@/lib/audit";
import { revalidatePath, revalidateTag } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import {
  createDocumentWithItems,
  updateDocumentWithItems,
  sendDocument,
} from "@/lib/document-actions";
import { requireModule } from "@/lib/module-guard";
import { acquireSendLock, SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";

const log = logger.child({ module: "quotes" });

export type QuoteFormState = {
  error?: string;
};

export async function createQuote(
  _prev: QuoteFormState,
  formData: FormData
): Promise<QuoteFormState> {
  const session = await requireEditor();
  await requireModule("quotes");
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const closingText = (formData.get("closingText") as string | null)?.trim().slice(0, 500) ?? "";
  const dateRaw = formData.get("date") as string;
  const validUntilRaw = formData.get("validUntil") as string;

  if (!customerIdRaw || !dateRaw || !validUntilRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);
  const customerError = await assertCustomerActive(prisma, customerId);
  if (customerError) return { error: customerError };

  const sender = await resolveSenderProfileId(prisma, formData.get("senderProfileId"));
  if (sender.error !== undefined) return { error: sender.error };

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  const totalOptions = await loadTotalOptions();
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData, totalOptions));
  } catch (err) {
    log.error({ err }, "createQuote: invalid items JSON");
    return { error: err instanceof DocumentItemsError ? err.message : "Ungültige Positionsdaten." };
  }

  let newQuoteId: number;
  try {
    ({ id: newQuoteId } = await createDocumentWithItems({
      kind: "quote",
      customerId,
      customUserText: customUserText || null,
      closingText: closingText || null,
      date: new Date(dateRaw),
      validUntil: new Date(validUntilRaw),
      totalAmount,
      discountPercent,
      items,
      senderProfileId: sender.id,
    }));
  } catch (err) {
    log.error({ err }, "createQuote failed");
    return { error: "Offerte konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Quote", newQuoteId);
  redirect(`/quotes/${newQuoteId}`);
}

export async function updateQuote(
  id: number,
  _prev: QuoteFormState,
  formData: FormData
): Promise<QuoteFormState> {
  const session = await requireEditor();
  await requireModule("quotes");
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const closingText = (formData.get("closingText") as string | null)?.trim().slice(0, 500) ?? "";
  const dateRaw = formData.get("date") as string;
  const validUntilRaw = formData.get("validUntil") as string;

  if (!customerIdRaw || !dateRaw || !validUntilRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);
  // Keeping the current customer is fine (drafts of customers archived later
  // stay editable); moving the quote to an archived one is not.
  const existing = await prisma.quote.findUnique({ where: { id }, select: { customerId: true, senderProfileId: true } });
  if (!existing) return { error: "Offerte nicht gefunden." };
  const customerError = await assertCustomerActive(prisma, customerId, existing.customerId);
  if (customerError) return { error: customerError };
  const sender = await resolveSenderProfileId(prisma, formData.get("senderProfileId"), existing.senderProfileId);
  if (sender.error !== undefined) return { error: sender.error };

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  const totalOptions = await loadTotalOptions();
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData, totalOptions));
  } catch (err) {
    log.error({ id, err }, "updateQuote: invalid items JSON");
    return { error: err instanceof DocumentItemsError ? err.message : "Ungültige Positionsdaten." };
  }

  try {
    await updateDocumentWithItems(id, {
      kind: "quote",
      customerId,
      customUserText: customUserText || null,
      closingText: closingText || null,
      date: new Date(dateRaw),
      validUntil: new Date(validUntilRaw),
      totalAmount,
      discountPercent,
      items,
      senderProfileId: sender.id,
    });
  } catch (err) {
    log.error({ id, err }, "updateQuote failed");
    return { error: "Offerte konnte nicht gespeichert werden." };
  }

  await logAudit(session, "UPDATE", "Quote", id);
  const from = formData.get("from") as string | null;
  const fromCustomer = from?.startsWith("customers/") ? from : null;
  redirect(`/quotes/${id}${fromCustomer ? `?from=${fromCustomer}` : ""}`);
}

export async function updateQuoteStatus(
  id: number,
  state: QuoteState
): Promise<void> {
  const session = await requireEditor();
  await requireModule("quotes");
  const current = await prisma.quote.findUnique({ where: { id }, select: { state: true, documentNumber: true },
  });
  if (!current) return;
  if (!current.documentNumber && (state === "Sent" || state === "Accepted")) {
    await assignDocumentNumber("quote", id, { actor: session });
  }
  await prisma.quote.update({ where: { id }, data: { state } });
}

export async function deleteQuote(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  await requireModule("quotes");
  const q = await prisma.quote.findUnique({ where: { id }, select: { documentNumber: true } });
  try {
    // Item.quote has no onDelete (SET NULL), so the items would stay behind as orphans.
    // Task.quote is SET NULL too: the open follow-up would stay open without its quote.
    await prisma.$transaction([
      prisma.task.updateMany({ where: { quoteId: id, doneAt: null }, data: { doneAt: new Date() } }),
      prisma.item.deleteMany({ where: { quoteId: id } }),
      prisma.quote.delete({ where: { id } }),
    ]);
  } catch (err) {
    log.error({ id, err }, "deleteQuote failed");
    return { error: "Offerte konnte nicht gelöscht werden. Es bestehen noch verknüpfte Daten." };
  }
  await logAudit(session, "DELETE", "Quote", id, q?.documentNumber ?? undefined);
  revalidatePath("/quotes");
  redirect("/quotes?flash=quote-deleted");
}

export async function sendQuote(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("quotes");

  const quoteId = parseInt(formData.get("quoteId") as string, 10);
  if (isNaN(quoteId)) return { error: "Ungültige Offerten-ID." };

  const to = ((formData.get("to") as string) ?? "").trim();
  const subject = ((formData.get("subject") as string) ?? "").trim();
  const body = ((formData.get("body") as string) ?? "").trim();
  if (!to) return { error: "Bitte eine Empfänger-E-Mail-Adresse angeben." };

  const result = await sendDocument({ kind: "quote", id: quoteId, to, subject, body, actor: session });
  if (result.error) return { error: result.error };
  return { success: true, _ts: Date.now() };
}

function findQuoteForConversion(quoteId: number) {
  return prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: true, customer: { select: { paymentTermDays: true, archivedAt: true } } },
  });
}

const ALREADY_CONVERTED_ERROR =
  "Diese Offerte wurde bereits in eine Rechnung umgewandelt.";

/** `again` is the explicit «Trotzdem eine weitere Rechnung erstellen» of the confirm dialog. */
export async function convertQuoteToInvoice(
  quoteId: number,
  options: { again?: boolean } = {}
): Promise<{ error?: string }> {
  const session = await requireEditor();
  await requireModule("quotes");
  const quote = await findQuoteForConversion(quoteId);

  if (!quote) return { error: "Offerte nicht gefunden." };
  // No new invoice for an archived customer; restoring the customer first is the way.
  if (quote.customer.archivedAt) return { error: CUSTOMER_ARCHIVED_ERROR };

  // One conversion per quote at a time: a double click or a second tab must not pass the check together
  const release = acquireSendLock(`quote-convert-${quoteId}`);
  if (!release) return { error: SEND_IN_PROGRESS_ERROR };
  try {
    if (!options.again && (await prisma.invoice.findFirst({ where: { sourceQuoteId: quoteId }, select: { id: true } }))) {
      return { error: ALREADY_CONVERTED_ERROR };
    }
    return await convertLocked(session, quote, quoteId);
  } finally {
    release();
  }
}

async function convertLocked(
  session: Awaited<ReturnType<typeof requireEditor>>,
  quote: NonNullable<Awaited<ReturnType<typeof findQuoteForConversion>>>,
  quoteId: number
): Promise<{ error?: string }> {

  const settings = await prisma.applicationSettings.findFirst();
  const paymentTermDays = effectivePaymentTermDays(quote.customer, settings?.defaultPaymentTermDays ?? 30);

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + paymentTermDays);

  const quoteNumber =
    quote.documentNumber ?? (await assignDocumentNumber("quote", quoteId, { actor: session }));

  let newInvoiceId: number;

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        customerId: quote.customerId,
        customUserText: quote.customUserText,
        date: today,
        dueDate,
        totalAmount: quote.totalAmount,
        discountPercent: quote.discountPercent,
        senderProfileId: quote.senderProfileId,
        state: "Draft",
        sourceQuoteId: quoteId,
      },
    });

    newInvoiceId = invoice.id;

    if (quote.items.length > 0) {
      await tx.item.createMany({
        data: quote.items.map((item) => ({
          invoiceId: invoice.id,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          discountPercent: item.discountPercent,
          totalAmount: item.totalAmount,
          customText: item.customText,
          categoryId: item.categoryId,
        })),
      });
    }

    await tx.quote.update({
      where: { id: quoteId },
      data: { state: "Accepted" },
    });
  });

  await logAudit(session, "CREATE", "Invoice", newInvoiceId!, undefined, {
    fromQuoteId: quoteId,
    fromQuote: quoteNumber,
  });
  await logAudit(session, "STATUS", "Quote", quoteId, quoteNumber, { from: quote.state, to: "Accepted" });

  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  redirect(`/invoices/${newInvoiceId!}`);
}
