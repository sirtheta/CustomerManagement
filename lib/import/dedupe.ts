import { createHash } from "crypto";
import type { ParsedTransaction } from "@/lib/import/types";

/**
 * Duplicate detection for statement imports. Statements overlap in practice
 * (a month is downloaded twice, period boundaries touch), so the same
 * movement must never be stored twice. The fingerprint is kept in
 * `BankTransaction.fingerprint` under a unique index, which makes the
 * database the last line of defence for concurrent uploads.
 *
 * Same scheme as the Budget app's `lib/import/dedupe.ts`: the bank reference
 * dominates when present; otherwise the hash includes an occurrence counter
 * so two genuinely identical bookings on one day (two CHF 4.50 coffees) both
 * import, while re-importing the same file skips both.
 */

/** Normalises free text so trivial formatting differences don't defeat matching. */
export function normalize(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const normalizeIban = (iban: string | null) => (iban ?? "").replace(/\s/g, "").toUpperCase();

export function fingerprint(
  iban: string | null,
  transaction: ParsedTransaction,
  occurrence: number
): string {
  const reference = transaction.bankReference?.trim();
  const parts = reference
    ? [normalizeIban(iban), reference]
    : [
        normalizeIban(iban),
        transaction.date,
        transaction.amountCents,
        normalize(transaction.description),
        normalize(transaction.counterparty),
        occurrence,
      ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Attaches a fingerprint to every transaction, numbering identical ones in reading order. */
export function withFingerprints(
  iban: string | null,
  transactions: ParsedTransaction[]
): Array<ParsedTransaction & { fingerprint: string }> {
  const seen = new Map<string, number>();
  return transactions.map((transaction) => {
    const key = [
      transaction.date,
      transaction.amountCents,
      normalize(transaction.description),
      normalize(transaction.counterparty),
    ].join("|");
    // Rows with a bank reference are fingerprinted by it and must not shift
    // the counter of reference-less twins (another export may omit the reference).
    let occurrence = 0;
    if (!transaction.bankReference?.trim()) {
      occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
    }
    return { ...transaction, fingerprint: fingerprint(iban, transaction, occurrence) };
  });
}
