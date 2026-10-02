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
 * True when a manual status change takes a draft out of Draft (Sent, Paid,
 * Overdue): updateInvoiceStatus then numbers and locks it, but sends no mail.
 * The status select asks for confirmation in exactly this case.
 */
export function locksDraftWithoutMail(from: InvoiceState, to: InvoiceState): boolean {
  return from === "Draft" && to !== "Draft";
}

/**
 * Marks overdue invoices (state=Sent, dueDate < now) as Overdue,
 * and expired quotes (state=Sent, validUntil < now) as Expired.
 *
 * Accepts a PrismaClient so it can be injected from tests or called
 * from a cron job / page loader with the global singleton.
 */
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
