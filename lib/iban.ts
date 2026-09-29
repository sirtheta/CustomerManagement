export type IbanValidation =
  | { valid: true; iban: string }
  | { valid: false; error: string };

// QR-bills only accept IBANs from Switzerland and Liechtenstein (21 chars).
const IBAN_LENGTH = 21;
const ALLOWED_COUNTRIES = ["CH", "LI"];

/** ISO 13616 check: move the first four chars to the end, letters → 10..35, mod 97 must be 1. */
function hasValidChecksum(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = String(parseInt(char, 36));
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function validateIban(input: string): IbanValidation {
  const iban = input.replace(/\s/g, "").toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, error: "Ungültiges Format." };
  }
  if (!ALLOWED_COUNTRIES.includes(iban.slice(0, 2))) {
    return { valid: false, error: "Nur Schweizer (CH) und liechtensteinische (LI) IBAN werden unterstützt." };
  }
  if (iban.length !== IBAN_LENGTH) {
    return { valid: false, error: `Die IBAN muss ${IBAN_LENGTH} Zeichen lang sein.` };
  }
  if (!hasValidChecksum(iban)) {
    return { valid: false, error: "Prüfsumme stimmt nicht." };
  }
  return { valid: true, iban };
}
