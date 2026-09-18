/** One transaction as parsed out of a bank statement file. */
export interface ParsedTransaction {
  /** Booking date, YYYY-MM-DD. */
  date: string;
  /** Signed amount in Rappen: negative = money out, positive = money in. */
  amountCents: number;
  description: string;
  counterparty: string | null;
  /** AcctSvcrRef / EndToEndId, when the file provides one. */
  bankReference: string | null;
}

/** Result of parsing a whole statement file. */
export interface ParsedStatement {
  transactions: ParsedTransaction[];
  /** IBAN the statement belongs to. */
  iban: string | null;
  currency: string | null;
  /** Closing balance reported by the bank, in Rappen. */
  closingBalanceCents: number | null;
  openingBalanceCents: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Non-fatal problems worth showing above the import preview. */
  warnings: string[];
}
