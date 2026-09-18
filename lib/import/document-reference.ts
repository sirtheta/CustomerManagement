/**
 * Invoice-number-shaped substrings (`<prefix><8 digits>`) found in a free
 * text payment description.
 *
 * Pure and prefix-driven, with no import of `@/lib/prisma` or anything else
 * heavy — shared by the automatic Budget-import matcher
 * (`lib/payment-matching.ts`) and the interactive CAMT-import preview
 * (`lib/import/matching.ts`) so both round-trip the QR-bill payment
 * reference (`buildQrBillData()` in `lib/pdf/qrbill-helpers.ts`) the same
 * way, and so a unit test of either can import it without a database.
 */

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractDocumentNumberCandidates(description: string, prefix: string): string[] {
  const pattern = new RegExp(`${escapeRegex(prefix)}\\d{8}`, "gi");
  return description.match(pattern) ?? [];
}
