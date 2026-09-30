import type { ParsedTransaction } from "@/lib/import/types";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

/**
 * Matches CAMT.053 statement entries to open invoices, so a bank export can
 * be reviewed and confirmed as payments without a bookkeeping ledger.
 *
 * Signals, strongest first:
 *  - the invoice number in the text (`extractDocumentNumberCandidates`, tolerant
 *    of spaces and a missing prefix) together with the open amount → pre-selected;
 *  - the open amount alone, or the number with a different amount → manual pick;
 *  - the customer's name in the counterparty → suggestion only, never pre-selected.
 */

export interface OpenInvoice {
  id: number;
  documentNumber: string;
  /** Francs still open: total minus recorded payments. */
  openAmount: number;
  /** Names the customer may appear under on a statement (company, contact person). */
  customerNames?: string[];
}

export interface MatchCandidate {
  invoiceId: number;
  documentNumber: string;
}

export type MatchConfidence = "reference" | "amount" | "name" | "none";

export interface MatchedTransaction<T extends ParsedTransaction = ParsedTransaction> {
  transaction: T;
  candidates: MatchCandidate[];
  confidence: MatchConfidence;
  /** Invoice id to pre-check in the preview, only set when confidence is "reference". */
  preselectedInvoiceId: number | null;
}

const MIN_NAME_LENGTH = 4;

function centsOf(francs: number): number {
  return Math.round(francs * 100);
}

function toCandidate(invoice: OpenInvoice): MatchCandidate {
  return { invoiceId: invoice.id, documentNumber: invoice.documentNumber };
}

/** Lowercase, without diacritics or punctuation, single-spaced. */
function nameKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mentionsCustomer(counterparty: string | null, invoice: OpenInvoice): boolean {
  const haystack = ` ${nameKey(counterparty)} `;
  if (haystack.trim() === "") return false;
  return (invoice.customerNames ?? []).some((name) => {
    const key = nameKey(name);
    return key.length >= MIN_NAME_LENGTH && haystack.includes(` ${key} `);
  });
}

function findReferencedInvoice(
  transaction: ParsedTransaction,
  openInvoices: OpenInvoice[],
  prefix: string
): OpenInvoice | null {
  const haystack = `${transaction.description} ${transaction.counterparty ?? ""}`;
  for (const documentNumber of extractDocumentNumberCandidates(haystack, prefix)) {
    const invoice = openInvoices.find(
      (inv) => inv.documentNumber.toUpperCase() === documentNumber.toUpperCase()
    );
    if (invoice) return invoice;
  }
  return null;
}

/**
 * Matches every incoming (credit) entry against the given open invoices
 * (callers pass invoices with `state` in `Sent`/`Overdue`/`PartiallyPaid`
 * only). Outgoing entries are dropped — they can never be an invoice payment.
 * `prefix` is `ApplicationSettings.invoiceNumberPrefix`.
 */
export function matchStatementToInvoices<T extends ParsedTransaction>(
  transactions: T[],
  openInvoices: OpenInvoice[],
  prefix: string
): MatchedTransaction<T>[] {
  return transactions
    .filter((transaction) => transaction.amountCents > 0)
    .map((transaction): MatchedTransaction<T> => {
      const referenced = findReferencedInvoice(transaction, openInvoices, prefix);
      const amountMatches = openInvoices.filter(
        (invoice) => centsOf(invoice.openAmount) === transaction.amountCents
      );
      const nameMatches = openInvoices.filter((invoice) =>
        mentionsCustomer(transaction.counterparty, invoice)
      );

      // Number and amount line up on the same invoice: safe to pre-select,
      // the user only has to confirm.
      if (referenced && centsOf(referenced.openAmount) === transaction.amountCents) {
        return {
          transaction,
          candidates: [toCandidate(referenced)],
          confidence: "reference",
          preselectedInvoiceId: referenced.id,
        };
      }

      const namedIds = new Set(nameMatches.map((invoice) => invoice.id));
      // Amount matches of a customer named in the text come first.
      const orderedAmount = [
        ...amountMatches.filter((invoice) => namedIds.has(invoice.id)),
        ...amountMatches.filter((invoice) => !namedIds.has(invoice.id)),
      ];
      const strong = referenced
        ? [referenced, ...orderedAmount.filter((invoice) => invoice.id !== referenced.id)]
        : orderedAmount;

      if (strong.length > 0) {
        const rest = nameMatches.filter((invoice) => !strong.some((s) => s.id === invoice.id));
        return {
          transaction,
          candidates: [...strong, ...rest].map(toCandidate),
          confidence: "amount",
          preselectedInvoiceId: null,
        };
      }

      if (nameMatches.length > 0) {
        return {
          transaction,
          candidates: nameMatches.map(toCandidate),
          confidence: "name",
          preselectedInvoiceId: null,
        };
      }

      return { transaction, candidates: [], confidence: "none", preselectedInvoiceId: null };
    });
}
