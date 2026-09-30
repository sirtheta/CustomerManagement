import type { InvoiceState, PrismaClient } from "@prisma/client";

/**
 * Manual status changes an invoice may go through. Choosing Paid books the
 * remaining amount as a payment (see updateInvoiceStatus); PartiallyPaid
 * follows from payments and Canceled from credit notes, so neither is a
 * manual target.
 */
const INVOICE_TRANSITIONS: Record<InvoiceState, readonly InvoiceState[]> = {
  Draft: ["Sent", "Paid"],
  Sent: ["Overdue", "Paid"],
  Overdue: ["Sent", "Paid"],
  PartiallyPaid: ["Paid"],
  Paid: [],
  Canceled: [],
};

export function canTransitionInvoice(from: InvoiceState, to: InvoiceState): boolean {
  return from === to || INVOICE_TRANSITIONS[from].includes(to);
}

export function allowedInvoiceTargets(from: InvoiceState): InvoiceState[] {
  return [from, ...INVOICE_TRANSITIONS[from]];
}

/**
 * Marks overdue invoices (state=Sent, dueDate < now) as Overdue,
 * and expired quotes (state=Sent, validUntil < now) as Expired.
 *
 * Accepts a PrismaClient so it can be injected from tests or called
 * from a cron job / page loader with the global singleton.
 */
export async function checkAndUpdateDocumentStates(
  prisma: PrismaClient,
  invoiceIds: number[],
  quoteIds: number[]
): Promise<void> {
  const now = new Date();

  if (invoiceIds.length > 0) {
    await prisma.invoice.updateMany({
      where: {
        id: { in: invoiceIds },
        state: "Sent",
        dueDate: { lt: now },
        creditNoteForId: null,
      },
      data: { state: "Overdue" },
    });
  }

  if (quoteIds.length > 0) {
    await prisma.quote.updateMany({
      where: {
        id: { in: quoteIds },
        state: "Sent",
        validUntil: { lt: now },
      },
      data: { state: "Expired" },
    });
  }
}

export async function checkAndUpdateAllDocumentStates(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.invoice.updateMany({
      where: { state: "Sent", dueDate: { lt: now }, creditNoteForId: null },
      data: { state: "Overdue" },
    }),
    prisma.quote.updateMany({
      where: { state: "Sent", validUntil: { lt: now } },
      data: { state: "Expired" },
    }),
  ]);
}
