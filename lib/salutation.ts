/**
 * Letter salutation of a customer (`Customer.title`, `salutationKind`, `salutationText`),
 * used for the `{salutation}` placeholder of every customer mail. Without a choice the
 * result is the old "Guten Tag <Kontaktperson>", so existing customers read as before.
 */

export const TITLE_VALUES = ["Herr", "Frau"] as const;
export type CustomerTitle = (typeof TITLE_VALUES)[number];

export const SALUTATION_KINDS = ["hello", "dear", "dearFormal", "formal", "formalPlural", "custom"] as const;
export type SalutationKind = (typeof SALUTATION_KINDS)[number];

export const SALUTATION_TEXT_MAX = 100;

/** Dropdown labels; the examples show what a mail will say for a person called Anna Muster. */
export const SALUTATION_LABELS: Record<SalutationKind, string> = {
  hello: "Guten Tag … (Standard)",
  dear: "Liebe(r) Vorname …",
  dearFormal: "Liebe(r) Herr/Frau Nachname …",
  formal: "Sehr geehrte(r) Herr/Frau Nachname …",
  formalPlural: "Sehr geehrte Damen und Herren",
  custom: "Eigener Text …",
};

/** Kinds that need Herr/Frau to pick the right form; without a title they fall back to the default. */
export const SALUTATION_KINDS_NEEDING_TITLE: readonly SalutationKind[] = ["dear", "dearFormal", "formal"];

export type SalutationFields = {
  contactPerson: string;
  title?: string | null;
  salutationKind?: string | null;
  salutationText?: string | null;
};

export function isSalutationKind(value: unknown): value is SalutationKind {
  return typeof value === "string" && (SALUTATION_KINDS as readonly string[]).includes(value);
}

export function isCustomerTitle(value: unknown): value is CustomerTitle {
  return typeof value === "string" && (TITLE_VALUES as readonly string[]).includes(value);
}

function nameParts(contactPerson: string): { first: string; last: string } {
  const words = contactPerson.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? "", last: words[words.length - 1] ?? "" };
}

/** The salutation line without trailing comma, e.g. "Sehr geehrte Frau Muster". */
export function buildSalutation(c: SalutationFields): string {
  const name = c.contactPerson.trim();
  const fallback = `Guten Tag ${name}`.trim();
  const title = isCustomerTitle(c.title) ? c.title : null;
  const { first, last } = nameParts(c.contactPerson);

  switch (isSalutationKind(c.salutationKind) ? c.salutationKind : "hello") {
    case "dear":
      if (!title || !first) return fallback;
      return `${title === "Herr" ? "Lieber" : "Liebe"} ${first}`;
    case "dearFormal":
      if (!title || !last) return fallback;
      return `${title === "Herr" ? "Lieber" : "Liebe"} ${title} ${last}`;
    case "formal":
      if (!title || !last) return fallback;
      return `${title === "Herr" ? "Sehr geehrter" : "Sehr geehrte"} ${title} ${last}`;
    case "formalPlural":
      return "Sehr geehrte Damen und Herren";
    case "custom":
      return c.salutationText?.trim() || fallback;
    default:
      return fallback;
  }
}
