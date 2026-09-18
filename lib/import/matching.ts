import type { ParsedTransaction } from "@/lib/import/types";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

/**
 * Matches CAMT.053 statement entries to open invoices, so a bank export can
 * be reviewed and confirmed as payments without a bookkeeping ledger.
 *
 * There is no stored transaction history to dedupe against (the CRM has no
 * accounts): once an invoice is marked `Paid` it drops out of the candidate
 * pool, so re-uploading the same statement simply produces no further
 * matches for it — that's the whole duplicate-prevention story.
 */

export interface OpenInvoice {
  id: number;
  documentNumber: string;
  /** Francs, as read from `Invoice.totalAmount`. */
  totalAmount: number;
}

export interface MatchCandidate {
  invoiceId: number;
  documentNumber: string;
}

export type MatchConfidence = "reference" | "amount" | "none";

export interface MatchedTransaction {
  transaction: ParsedTransaction;
  candidates: MatchCandidate[];
  confidence: MatchConfidence;
  /** Invoice id to pre-check in the preview, only set when confidence is "reference". */
  preselectedInvoiceId: number | null;
}

function centsOf(francs: number): number {
  return Math.round(francs * 100);
}

function toCandidate(invoice: OpenInvoice): MatchCandidate {
  return { invoiceId: invoice.id, documentNumber: invoice.documentNumber };
}

/**
 * Finds an open invoice whose `documentNumber` appears in the entry's
 * description or counterparty text.
 *
 * Uses the same `extractDocumentNumberCandidates()` (`lib/payment-matching.ts`)
 * as the automatic Budget-import matcher, so both round-trip the QR-bill
 * payment reference identically: `buildQrBillData()`
 * (`lib/pdf/qrbill-helpers.ts`) puts the invoice's `documentNumber` into the
 * QR message, and a QR-bill payment carries that message back unchanged in
 * `RmtInf/Ustrd`.
 */
function findReferencedInvoice(
  transaction: ParsedTransaction,
  openInvoices: OpenInvoice[],
  prefix: string
): OpenInvoice | null {
  const haystack = `${transaction.description} ${transaction.counterparty ?? ""}`;
  const candidates = extractDocumentNumberCandidates(haystack, prefix);
  for (const documentNumber of candidates) {
    const invoice = openInvoices.find(
      (inv) => inv.documentNumber.toUpperCase() === documentNumber.toUpperCase()
    );
    if (invoice) return invoice;
  }
  return null;
}

/**
 * Matches every incoming (credit) statement entry against the given open
 * invoices (callers should pass invoices with `state` in `Sent`/`Overdue`
 * only). Outgoing entries are dropped — they can never be an invoice payment.
 * `prefix` is `ApplicationSettings.invoiceNumberPrefix`.
 */
export function matchStatementToInvoices(
  transactions: ParsedTransaction[],
  openInvoices: OpenInvoice[],
  prefix: string
): MatchedTransaction[] {
  return transactions
    .filter((transaction) => transaction.amountCents > 0)
    .map((transaction) => {
      const referenced = findReferencedInvoice(transaction, openInvoices, prefix);
      const amountMatches = openInvoices.filter(
        (invoice) => centsOf(invoice.totalAmount) === transaction.amountCents
      );

      // Reference and amount both line up on the same invoice: safe to
      // pre-select, the user only has to confirm.
      if (referenced && centsOf(referenced.totalAmount) === transaction.amountCents) {
        return {
          transaction,
          candidates: [toCandidate(referenced)],
          confidence: "reference" as const,
          preselectedInvoiceId: referenced.id,
        };
      }

      // Either the reference matched an invoice with a different amount
      // (partial payment, rounding, typo'd reference), or only the amount
      // lines up (possibly on more than one invoice) — either way this
      // needs a manual pick.
      const candidates = referenced
        ? [referenced, ...amountMatches.filter((invoice) => invoice.id !== referenced.id)]
        : amountMatches;

      if (candidates.length > 0) {
        return {
          transaction,
          candidates: candidates.map(toCandidate),
          confidence: "amount" as const,
          preselectedInvoiceId: null,
        };
      }

      return {
        transaction,
        candidates: [],
        confidence: "none" as const,
        preselectedInvoiceId: null,
      };
    });
}
