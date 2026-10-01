// Swiss enterprise identification number (UID): CHE-123.456.789, optionally
// followed by a VAT suffix (MWST / TVA / IVA). The last digit is a modulo-11
// check digit over the first eight digits.
const UID_PATTERN = /^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})(?:\s*(?:MWST|TVA|IVA))?$/;

export function normalizeUid(input: string): string | null {
  const match = UID_PATTERN.exec(input.trim().toUpperCase());
  if (!match) return null;
  return `CHE-${match[1]}.${match[2]}.${match[3]}`;
}

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4];

export function isValidUid(input: string): boolean {
  const normalized = normalizeUid(input);
  if (!normalized) return false;
  const digits = normalized.replace(/\D/g, "");
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(digits[8]);
}
