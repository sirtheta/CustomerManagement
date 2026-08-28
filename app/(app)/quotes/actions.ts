"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { QuoteState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { generateQuoteNumber, generateInvoiceNumber } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import { logAudit } from "@/lib/audit";
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendQuoteEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { saveItemsToCatalog } from "@/lib/service-catalog";

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
  try {
    ({ items, totalAmount } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ err }, "createQuote: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  const documentNumber = await generateQuoteNumber();

  let newQuoteId!: number;

  try {
    await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          customerId,
          documentNumber,
          customUserText: customUserText || null,
          date: new Date(dateRaw),
          validUntil: new Date(validUntilRaw),
          totalAmount,
          state: "Draft",
        },
      });

      newQuoteId = quote.id;

      await saveItemsToCatalog(tx, items);

      if (items.length > 0) {
        await tx.item.createMany({
          data: items.map((item) => ({
            quoteId: quote.id,
            name: item.name,
            description: item.description || null,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalAmount: item.totalAmount,
            customText: item.customText || null,
            categoryId: item.categoryId,
          })),
        });
      }
    });
  } catch (err) {
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
  try {
    ({ items, totalAmount } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ id, err }, "updateQuote: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.item.deleteMany({ where: { quoteId: id } });
      await tx.quote.update({
        where: { id },
        data: {
          customerId,
          customUserText: customUserText || null,
          date: new Date(dateRaw),
          validUntil: new Date(validUntilRaw),
          totalAmount,
          version: { increment: 1 },
        },
      });

      await saveItemsToCatalog(tx, items);

      if (items.length > 0) {
        await tx.item.createMany({
          data: items.map((item) => ({
            quoteId: id,
            name: item.name,
            description: item.description || null,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalAmount: item.totalAmount,
            customText: item.customText || null,
            categoryId: item.categoryId,
          })),
        });
      }
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

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!quote) return { error: "Offerte nicht gefunden." };
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  try {
    const pdf = await generateQuotePdf(quote, settings);
    await sendQuoteEmail(quote, settings, pdf, { to, subject, body });
  } catch (err) {
    log.error({ quoteId, to, err }, "sendQuote failed");
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { error: message };
  }

  await prisma.$transaction([
    prisma.quote.update({ where: { id: quoteId }, data: { state: "Sent" } }),
    prisma.quoteSentLog.create({ data: { quoteId, sentTo: to, subject } }),
  ]);
  await logAudit(session, "SEND", "Quote", quoteId, quote.documentNumber, { to });
  revalidatePath(`/quotes/${quoteId}`);
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

  const documentNumber = await generateInvoiceNumber();
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + paymentTermDays);

  let newInvoiceId: number;

  await prisma.$transaction(async (tx) => {
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

  redirect(`/invoices/${newInvoiceId!}`);
}
