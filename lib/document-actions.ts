import defaultPrisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { generateInvoiceNumber, generateQuoteNumber } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { saveItemsToCatalog } from "@/lib/service-catalog";
import { generateInvoicePdf, generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "document-actions" });

/**
 * Shared by `app/(app)/invoices/actions.ts` and `app/(app)/quotes/actions.ts`,
 * which are otherwise near-identical (same transaction/send/audit shape) —
 * see review finding #10. Branching on `kind` instead of a Prisma generic
 * keeps each side's `data` object plainly typed against its own delegate.
 */
type DocumentKind = "invoice" | "quote";

export function isDocumentNumberCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    ((err.meta?.target as string[] | undefined)?.includes("documentNumber") ?? false)
  );
}

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

export type CreateDocumentInput = {
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
  input: CreateDocumentInput
): Promise<{ id: number; documentNumber: string }> {
  let id!: number;
  let documentNumber!: string;

  const attempt = () =>
    defaultPrisma.$transaction(async (tx) => {
      if (input.kind === "invoice") {
        documentNumber = await generateInvoiceNumber(tx);
        const invoice = await tx.invoice.create({
          data: {
            customerId: input.customerId,
            documentNumber,
            customUserText: input.customUserText,
            date: input.date,
            dueDate: input.dueDate!,
            totalAmount: input.totalAmount,
            discountPercent: input.discountPercent,
            state: "Draft",
          },
        });
        id = invoice.id;
      } else {
        documentNumber = await generateQuoteNumber(tx);
        const quote = await tx.quote.create({
          data: {
            customerId: input.customerId,
            documentNumber,
            customUserText: input.customUserText,
            date: input.date,
            validUntil: input.validUntil!,
            totalAmount: input.totalAmount,
            discountPercent: input.discountPercent,
            state: "Draft",
          },
        });
        id = quote.id;
      }

      await saveItemsToCatalog(tx, input.items);
      await createItems(tx, input.kind, id, input.items);
    });

  try {
    await attempt();
  } catch (err) {
    if (!isDocumentNumberCollision(err)) throw err;
    log.warn({ documentNumber, kind: input.kind }, "document number collision, retrying");
    await attempt();
  }

  return { id, documentNumber };
}

export type UpdateDocumentInput = {
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

export async function updateDocumentWithItems(
  id: number,
  input: UpdateDocumentInput
): Promise<void> {
  await defaultPrisma.$transaction(async (tx) => {
    if (input.kind === "invoice") {
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

  if (input.kind === "invoice") {
    const invoice = await defaultPrisma.invoice.findUnique({
      where: { id: input.id },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    });
    if (!invoice) return { error: "Rechnung nicht gefunden." };

    try {
      const pdf = await generateInvoicePdf(invoice, settings);
      await sendInvoiceEmail(invoice, settings, pdf, {
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    } catch (err) {
      log.error({ invoiceId: input.id, to: input.to, err }, "sendDocument (invoice) failed");
      return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
    }

    await defaultPrisma.$transaction([
      defaultPrisma.invoice.update({ where: { id: input.id }, data: { state: "Sent" } }),
      defaultPrisma.invoiceSentLog.create({
        data: { invoiceId: input.id, sentTo: input.to, subject: input.subject },
      }),
    ]);
    await logAudit(input.actor, "SEND", "Invoice", input.id, invoice.documentNumber, {
      to: input.to,
    });
    revalidatePath(`/invoices/${input.id}`);
    revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  } else {
    const quote = await defaultPrisma.quote.findUnique({
      where: { id: input.id },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    });
    if (!quote) return { error: "Offerte nicht gefunden." };

    try {
      const pdf = await generateQuotePdf(quote, settings);
      await sendQuoteEmail(quote, settings, pdf, {
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    } catch (err) {
      log.error({ quoteId: input.id, to: input.to, err }, "sendDocument (quote) failed");
      return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
    }

    await defaultPrisma.$transaction([
      defaultPrisma.quote.update({ where: { id: input.id }, data: { state: "Sent" } }),
      defaultPrisma.quoteSentLog.create({
        data: { quoteId: input.id, sentTo: input.to, subject: input.subject },
      }),
    ]);
    await logAudit(input.actor, "SEND", "Quote", input.id, quote.documentNumber, {
      to: input.to,
    });
    revalidatePath(`/quotes/${input.id}`);
  }

  return { success: true };
}
