import prisma from "@/lib/prisma";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";

// Actor used for audit log entries triggered by the Budget app's import,
// where no logged-in user exists. `logAudit` only reads `user.{id,name,email}`.
const SYSTEM_ACTOR = {
  user: { id: "0", name: "Budget-Import", email: "system@budget" },
} as Session;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function extractDocumentNumberCandidates(description: string): Promise<string[]> {
  const settings = await prisma.applicationSettings.findFirst();
  const prefix = settings?.invoiceNumberPrefix ?? "R-";
  const pattern = new RegExp(`${escapeRegex(prefix)}\\d{8}`, "gi");
  return description.match(pattern) ?? [];
}

export type PaymentMatchResult =
  | { matched: true; invoiceId: number; documentNumber: string }
  | { matched: false };

/**
 * Looks for an unpaid invoice whose documentNumber appears in the given
 * description, and whose totalAmount matches the paid amount exactly.
 * Marks it Paid on a match. Never throws.
 */
export async function matchAndMarkPaid(params: {
  description: string;
  amountRappen: number;
  bookingDate?: string;
}): Promise<PaymentMatchResult> {
  const candidates = await extractDocumentNumberCandidates(params.description);

  for (const documentNumber of candidates) {
    const invoice = await prisma.invoice.findFirst({
      where: { documentNumber, state: { not: "Paid" } },
    });
    if (!invoice) continue;

    const totalAmountRappen = Math.round(Number(invoice.totalAmount) * 100);
    if (totalAmountRappen !== params.amountRappen) continue;

    const paidDate = params.bookingDate ? new Date(params.bookingDate) : new Date();

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { state: "Paid", paidDate },
    });

    await logAudit(SYSTEM_ACTOR, "STATUS", "Invoice", invoice.id, documentNumber, {
      from: invoice.state,
      to: "Paid",
      source: "budget-import",
    });

    return { matched: true, invoiceId: invoice.id, documentNumber };
  }

  return { matched: false };
}
