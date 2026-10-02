import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { getPaymentSummary, recordPayment } from "@/lib/payments";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";
import { DEFAULT_PREFIXES } from "@/lib/document-number";
import { BUDGET_IMPORT_ACTOR } from "@/lib/system-actor";

export type PaymentMatchResult =
  | { matched: true; invoiceId: number; documentNumber: string }
  | { matched: false };

/**
 * Looks for an unpaid invoice whose documentNumber appears in the given
 * description, and whose remaining amount matches the paid amount exactly.
 * Records a payment on a match. Does not swallow errors: database failures
 * and `recordPayment` rejections (e.g. `PaymentError`) propagate, so callers
 * must catch them (the external payments route does). Returns
 * `{ matched: false }` when nothing fits.
 */
export async function matchAndMarkPaid(
  params: {
    description: string;
    amountRappen: number;
    bookingDate?: string;
    bankReference?: string;
  },
  prisma: PrismaClient = defaultPrisma
): Promise<PaymentMatchResult> {
  const settings = await prisma.applicationSettings.findFirst();
  const prefix = settings?.invoiceNumberPrefix ?? DEFAULT_PREFIXES.invoice;
  const candidates = extractDocumentNumberCandidates(params.description, prefix);

  for (const documentNumber of candidates) {
    const invoice = await prisma.invoice.findFirst({
      where: { documentNumber, state: { in: ["Sent", "Overdue", "PartiallyPaid"] } },
    });
    if (!invoice) continue;

    const { remainingRappen } = await getPaymentSummary(invoice.id, prisma);
    if (remainingRappen !== params.amountRappen) continue;

    // The same bank entry must not be booked twice on one invoice.
    if (
      params.bankReference &&
      (await prisma.payment.count({
        where: { invoiceId: invoice.id, bankReference: params.bankReference },
      })) > 0
    ) {
      continue;
    }

    const parsed = params.bookingDate ? new Date(params.bookingDate) : new Date();
    const paidDate = isNaN(parsed.getTime()) ? new Date() : parsed;

    await recordPayment(
      {
        invoiceId: invoice.id,
        amount: params.amountRappen / 100,
        date: paidDate,
        source: "budget-import",
        bankReference: params.bankReference,
        actor: BUDGET_IMPORT_ACTOR,
      },
      prisma
    );

    return { matched: true, invoiceId: invoice.id, documentNumber };
  }

  return { matched: false };
}
