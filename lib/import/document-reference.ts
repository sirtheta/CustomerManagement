/**
 * Invoice numbers (`<prefix><8 digits>`) mentioned in a free-text payment
 * description, returned in canonical form (`prefix` + digits).
 *
 * Payers retype the QR-bill reference, so the match is tolerant: any case,
 * whitespace/dots/dashes between prefix and digits or inside the digits, and
 * the bare eight digits without the prefix. The result is only ever used to
 * look up real open invoices, so a false candidate is harmless unless it
 * equals an existing number.
 *
 * Pure and prefix-driven, with no import of `@/lib/prisma` or anything else
 * heavy — shared by the automatic Budget-import matcher
 * (`lib/payment-matching.ts`) and the interactive CAMT-import preview
 * (`lib/import/matching.ts`).
 */

const SEPARATOR = "[\\s.\\-_]";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractDocumentNumberCandidates(description: string, prefix: string): string[] {
  const found: string[] = [];
  const add = (digits: string) => {
    const number = `${prefix}${digits.replace(/\D/g, "")}`;
    if (!found.includes(number)) found.push(number);
  };

  // Separators in the configured prefix ("I-") are optional in the text.
  const prefixChars = Array.from(prefix.replace(/[\s.\-_]+/g, ""));
  if (prefixChars.length > 0) {
    const withPrefix = new RegExp(
      `(?<![A-Za-z0-9])${prefixChars.map(escapeRegex).join(`${SEPARATOR}*`)}${SEPARATOR}*(\\d(?:${SEPARATOR}?\\d){7})(?!\\d)`,
      "gi"
    );
    for (const match of description.matchAll(withPrefix)) add(match[1]);
  }

  // Bare digits: delimited by non-digits and not directly behind a letter
  // ("Q-26010003" is a quote number, not an invoice number).
  for (const match of description.matchAll(/(?<![A-Za-z][.\-_]?)(?<!\d)\d{8}(?!\d)/g)) add(match[0]);

  return found;
}
