/**
 * Structured postal addresses as required by the Swiss QR-bill: street and
 * building number are separate fields, and the country is an ISO 3166-1
 * alpha-2 code. Field lengths follow the QR-bill implementation guidelines.
 */

export const ADDRESS_LIMITS = {
  street: 70,
  houseNumber: 16,
  zip: 16,
  city: 35,
} as const;

/** Countries offered in the customer form (ISO code -> German name). */
export const COUNTRIES: Record<string, string> = {
  CH: "Schweiz",
  LI: "Liechtenstein",
  DE: "Deutschland",
  AT: "Österreich",
  FR: "Frankreich",
  IT: "Italien",
  BE: "Belgien",
  ES: "Spanien",
  LU: "Luxemburg",
  NL: "Niederlande",
  PT: "Portugal",
  GB: "Vereinigtes Königreich",
  US: "Vereinigte Staaten",
};

/** The creditor of a QR-bill must be located in Switzerland or Liechtenstein. */
export const CREDITOR_COUNTRIES = ["CH", "LI"] as const;

export function countryName(code: string): string {
  return COUNTRIES[code] ?? code;
}

export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/** "Musterstrasse 12a" — street and optional house number on one line. */
export function formatStreetLine(street?: string | null, houseNumber?: string | null): string {
  return [street, houseNumber]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/** "8000 Zürich" */
export function formatCityLine(zip?: string | null, city?: string | null): string {
  return [zip, city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Splits a free-text street line the same way the `structured_addresses`
 * migration does: the last space-separated token becomes the house number if
 * it starts with a digit. Anything else stays in the street.
 */
export function splitStreetLine(line: string): { street: string; houseNumber: string | null } {
  const trimmed = line.trim();
  const sp = trimmed.lastIndexOf(" ");
  if (sp > 0 && /^\d/.test(trimmed.slice(sp + 1))) {
    return { street: trimmed.slice(0, sp).trim(), houseNumber: trimmed.slice(sp + 1) };
  }
  return { street: trimmed, houseNumber: null };
}
