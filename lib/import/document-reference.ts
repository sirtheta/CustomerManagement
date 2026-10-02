/**
 * Invoice numbers (`<prefix><8 digits>`) mentioned in a free-text payment
 * description, returned in canonical form (`prefix` + digits).
 *
 * Payers retype the QR-bill reference, so the match is tolerant: any case,
 * whitespace/dots/dashes between prefix and digits or inside the digits, and
 * the bare eight digits without the prefix (also with spaces or `. - / _`
 * inside, but not as a date or out of a longer grouped number). The result is only ever used to
 * look up real open invoices, so a false candidate is harmless unless it
 * equals an existing number.
 *
 * Pure and prefix-driven, with no import of `@/lib/prisma` or anything else
 * heavy — shared by the automatic Budget-import matcher
 * (`lib/payment-matching.ts`) and the interactive CAMT-import preview
 * (`lib/import/matching.ts`).
 */

const SEPARATOR = "[\\s.\\-_]";
/** Separators a payer types inside the bare digits (also "/"). */
const BARE_SEPARATOR = "[\\s.\\-_/]";

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

  // Bare digits: eight digits, optionally with one separator between any two
  // of them ("2610 0135", "2610.0135"), not behind a LONE letter
  // ("Q-26010003" is a quote number, not an invoice number). A letter that
  // ends a longer word ("Rg.", "Nr.", "Rechnung-") does not block the match.
  // The run must not continue on either side, not even across one separator,
  // so groups out of a longer number (IBAN "CH93 0076 2011 …", QR reference,
  // phone number "079 123 45 67") never yield eight digits.
  const bare = new RegExp(
    `(?<!(?<![A-Za-z])[A-Za-z][.\\-_]?)(?<!\\d${BARE_SEPARATOR}?)\\d(?:${BARE_SEPARATOR}?\\d){7}(?!${BARE_SEPARATOR}?\\d)`,
    "g"
  );
  for (const match of description.matchAll(bare)) {
    if (looksLikeDate(match[0])) continue;
    add(match[0]);
  }

  return found;
}

/**
 * "26.10.2025", "26/10/2025" or "2025-10-26": eight digits as a date
 * (groups 2-2-4 or 4-2-2), which is no invoice number. The contiguous form
 * "26102025" is still accepted.
 */
function looksLikeDate(text: string): boolean {
  const groups = text.split(/[\s.\-_/]/).map((group) => group.length);
  const shape = groups.join("-");
  return shape === "2-2-4" || shape === "4-2-2";
}
