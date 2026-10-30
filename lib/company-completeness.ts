import type { CompanyInformation } from "@prisma/client";

type CompanyFields = Pick<
  CompanyInformation,
  | "companyName"
  | "companyHolderName"
  | "companyIBAN"
  | "companyStreet"
  | "companyZip"
  | "companyCity"
  | "companyEmail"
  | "companyPhone"
  | "companyLogo"
>;

type Field = { key: keyof CompanyFields; label: string };

/** What the QR bill needs, so an invoice can be paid at all. */
const MANDATORY: Field[] = [
  { key: "companyIBAN", label: "IBAN" },
  { key: "companyStreet", label: "Strasse" },
  { key: "companyZip", label: "PLZ" },
  { key: "companyCity", label: "Ort" },
];

const OPTIONAL: Field[] = [
  { key: "companyEmail", label: "E-Mail" },
  { key: "companyPhone", label: "Telefon" },
  { key: "companyLogo", label: "Logo" },
];

function isEmpty(value: CompanyFields[keyof CompanyFields] | undefined): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  return value.length === 0;
}

/**
 * Without a company name the holder name is the only creditor name (`buildQrBillData` falls back
 * to it whatever the switch says), so «Inhabername auf QR-Rechnung verwenden» is fixed to on.
 */
export function holderNameOnQrForced(company: Partial<CompanyFields> | null | undefined): boolean {
  return isEmpty(company?.companyName);
}

/**
 * Why «Inhabername auf QR-Rechnung verwenden» cannot be switched on yet (null = it can): the
 * holder name is then the QR-bill creditor, so it and the creditor account and address must exist.
 * Checked against the stored company data, because the switch saves on click.
 */
export function holderNameOnQrBlocker(company: Partial<CompanyFields> | null | undefined): string | null {
  const missing = [{ key: "companyHolderName", label: "Inhaber / Name" } as Field, ...MANDATORY]
    .filter(({ key }) => isEmpty(company?.[key]))
    .map(({ label }) => label);
  return missing.length
    ? `Zuerst ${missing.join(", ")} bei den Firmendaten ausfüllen und speichern.`
    : null;
}

/**
 * Labels of the company data that are still empty for the first-start checklist. The company name
 * is optional: without it the holder name is the QR-bill creditor (`buildQrBillData`), so the
 * mandatory fields alone complete the step. With a company name the checklist also wants the
 * optional fields (e-mail, phone, logo) for a complete profile. House number stays out, many
 * addresses have none.
 */
export function missingCompanyFields(company: Partial<CompanyFields> | null | undefined): string[] {
  const hasName = !isEmpty(company?.companyName);
  const fields: Field[] = hasName
    ? [...MANDATORY, ...OPTIONAL]
    : [{ key: "companyHolderName", label: "Inhaber-Name" }, ...MANDATORY];
  return fields.filter(({ key }) => isEmpty(company?.[key])).map(({ label }) => label);
}
