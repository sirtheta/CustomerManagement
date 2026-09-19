"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { QuoteState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { generateInvoiceNumber } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import { logAudit } from "@/lib/audit";
import { revalidatePath, revalidateTag } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import {
  createDocumentWithItems,
  updateDocumentWithItems,
  sendDocument,
  isDocumentNumberCollision,
} from "@/lib/document-actions";

const log = logger.child({ module: "quotes" });

export type QuoteFormState = {
  error?: string;
};

export async function createQuote(
  _prev: QuoteFormState,
  formData: FormData
): Promise<QuoteFormState> {
  const session = await requireEditor();
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const dateRaw = formData.get("date") as string;
  const validUntilRaw = formData.get("validUntil") as string;

  if (!customerIdRaw || !dateRaw || !validUntilRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ err }, "createQuote: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  let newQuoteId: number;
  let documentNumber: string;
  try {
    ({ id: newQuoteId, documentNumber } = await createDocumentWithItems({
      kind: "quote",
      customerId,
      customUserText: customUserText || null,
      date: new Date(dateRaw),
      validUntil: new Date(validUntilRaw),
      totalAmount,
      discountPercent,
      items,
    }));
  } catch (err) {
    if (isDocumentNumberCollision(err)) {
      log.error({ err }, "createQuote failed after retry");
      return { error: "Offertennummer war belegt, bitte erneut versuchen." };
    }
    log.error({ err }, "createQuote failed");
    return { error: "Offerte konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Quote", newQuoteId, documentNumber);
  redirect(`/quotes/${newQuoteId}`);
}

export async function updateQuote(
  id: number,
  _prev: QuoteFormState,
  formData: FormData
): Promise<QuoteFormState> {
  const session = await requireEditor();
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const dateRaw = formData.get("date") as string;
  const validUntilRaw = formData.get("validUntil") as string;

  if (!customerIdRaw || !dateRaw || !validUntilRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ id, err }, "updateQuote: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  try {
    await updateDocumentWithItems(id, {
      kind: "quote",
      customerId,
      customUserText: customUserText || null,
      date: new Date(dateRaw),
      validUntil: new Date(validUntilRaw),
      totalAmount,
      discountPercent,
      items,
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
  await requireEditor();
  await prisma.quote.update({ where: { id }, data: { state } });
}

export async function deleteQuote(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const q = await prisma.quote.findUnique({ where: { id }, select: { documentNumber: true } });
  try {
    await prisma.quote.delete({ where: { id } });
  } catch (err) {
    log.error({ id, err }, "deleteQuote failed");
    return { error: "Offerte konnte nicht gelöscht werden. Es bestehen noch verknüpfte Daten." };
  }
  await logAudit(session, "DELETE", "Quote", id, q?.documentNumber);
  revalidatePath("/quotes");
  redirect("/quotes");
}

export async function sendQuote(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

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

export async function convertQuoteToInvoice(quoteId: number): Promise<{ error?: string }> {
  await requireEditor();
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: true },
  });

  if (!quote) return { error: "Offerte nicht gefunden." };

  const settings = await prisma.applicationSettings.findFirst();
  const paymentTermDays = settings?.defaultPaymentTermDays ?? 30;

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + paymentTermDays);

  let newInvoiceId: number;

  await prisma.$transaction(async (tx) => {
    const documentNumber = await generateInvoiceNumber(tx);
    const invoice = await tx.invoice.create({
      data: {
        customerId: quote.customerId,
        documentNumber,
        customUserText: quote.customUserText,
        date: today,
        dueDate,
        totalAmount: quote.totalAmount,
        state: "Draft",
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

  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  redirect(`/invoices/${newInvoiceId!}`);
}
