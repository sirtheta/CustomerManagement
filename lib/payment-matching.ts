import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

// Actor used for audit log entries triggered by the Budget app's import,
// where no logged-in user exists. `logAudit` only reads `user.{id,name,email}`.
const SYSTEM_ACTOR = {
  user: { id: "0", name: "Budget-Import", email: "system@budget" },
} as Session;

export type PaymentMatchResult =
  | { matched: true; invoiceId: number; documentNumber: string }
  | { matched: false };

/**
 * Marks an invoice Paid and writes the audit trail. Shared by the automatic
 * Budget-import matcher below and the interactive CAMT-import UI
 * (`app/(app)/invoices/actions.ts`), which supplies the logged-in user as
 * `actor` instead of `SYSTEM_ACTOR`.
 */
export async function markInvoicePaid(
  params: {
    invoiceId: number;
    documentNumber: string;
    previousState: string;
    paidDate: Date;
    actor: Session;
    source: "budget-import" | "camt-import";
    bankReference?: string | null;
  },
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  await prisma.invoice.update({
    where: { id: params.invoiceId },
    data: { state: "Paid", paidDate: params.paidDate },
  });

  // A paid invoice no longer needs a reminder; drop the pending one (if any)
  // so it leaves the Mahnungen list and the header badge immediately.
  await prisma.pendingReminder.deleteMany({ where: { invoiceId: params.invoiceId } });

  await logAudit(
    params.actor,
    "STATUS",
    "Invoice",
    params.invoiceId,
    params.documentNumber,
    {
      from: params.previousState,
      to: "Paid",
      source: params.source,
      ...(params.bankReference !== undefined ? { bankReference: params.bankReference } : {}),
    },
    prisma
  );
}

/**
 * Looks for an unpaid invoice whose documentNumber appears in the given
 * description, and whose totalAmount matches the paid amount exactly.
 * Marks it Paid on a match. Never throws.
 */
export async function matchAndMarkPaid(
  params: {
    description: string;
    amountRappen: number;
    bookingDate?: string;
  },
  prisma: PrismaClient = defaultPrisma
): Promise<PaymentMatchResult> {
  const settings = await prisma.applicationSettings.findFirst();
  const prefix = settings?.invoiceNumberPrefix ?? "R-";
  const candidates = extractDocumentNumberCandidates(params.description, prefix);

  for (const documentNumber of candidates) {
    const invoice = await prisma.invoice.findFirst({
      where: { documentNumber, state: { not: "Paid" } },
    });
    if (!invoice) continue;

    const totalAmountRappen = Math.round(Number(invoice.totalAmount) * 100);
    if (totalAmountRappen !== params.amountRappen) continue;

    const paidDate = params.bookingDate ? new Date(params.bookingDate) : new Date();

    await markInvoicePaid(
      {
        invoiceId: invoice.id,
        documentNumber,
        previousState: invoice.state,
        paidDate,
        actor: SYSTEM_ACTOR,
        source: "budget-import",
      },
      prisma
    );

    return { matched: true, invoiceId: invoice.id, documentNumber };
  }

  return { matched: false };
}
