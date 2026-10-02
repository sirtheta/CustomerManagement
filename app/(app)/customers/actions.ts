"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { ADDRESS_LIMITS, isCountryCode } from "@/lib/address";
import { isValidUid, normalizeUid } from "@/lib/customer-uid";
import { nextCustomerNumber } from "@/lib/customer-number";

export type CustomerFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted form values, returned with errors so the form can refill itself. */
  values?: Record<string, string>;
};

const optionalText = (max: number, label: string) =>
  z.string().max(max, `${label} darf maximal ${max} Zeichen lang sein.`).nullable();

const customerSchema = z
  .object({
    company: z.string().nullable(),
    contactPerson: z.string().min(1, "Kontaktperson ist erforderlich."),
    street: z
      .string()
      .min(1, "Strasse ist erforderlich.")
      .max(ADDRESS_LIMITS.street, `Strasse darf maximal ${ADDRESS_LIMITS.street} Zeichen lang sein.`),
    houseNumber: z
      .string()
      .max(ADDRESS_LIMITS.houseNumber, `Hausnummer darf maximal ${ADDRESS_LIMITS.houseNumber} Zeichen lang sein.`)
      .nullable(),
    city: z
      .string()
      .min(1, "Ort ist erforderlich.")
      .max(ADDRESS_LIMITS.city, `Ort darf maximal ${ADDRESS_LIMITS.city} Zeichen lang sein.`),
    zipCode: z
      .string()
      .min(1, "PLZ ist erforderlich.")
      .max(ADDRESS_LIMITS.zip, `PLZ darf maximal ${ADDRESS_LIMITS.zip} Zeichen lang sein.`),
    country: z.string().refine(isCountryCode, "Ungültiger Ländercode."),
    email: z.string().email("Ungültige E-Mail-Adresse."),
    phone: z.string().nullable(),
    customerNumber: z
      .string()
      .nullable()
      .refine((v) => v === null || (/^\d{1,9}$/.test(v) && Number(v) >= 1), "Kundennummer muss eine ganze Zahl ab 1 sein."),
    uid: z
      .string()
      .nullable()
      .superRefine((v, ctx) => {
        if (v === null) return;
        if (normalizeUid(v) === null) {
          ctx.addIssue({ code: "custom", message: "Ungültiges UID-Format. Erwartet wird z. B. CHE-123.456.788 (optional mit MWST)." });
        } else if (!isValidUid(v)) {
          ctx.addIssue({ code: "custom", message: "Ungültige UID: Die Prüfziffer stimmt nicht. Bitte die Nummer prüfen." });
        }
      }),
    paymentTermDays: z
      .string()
      .nullable()
      .refine(
        (v) => v === null || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365),
        "Zahlungsfrist muss zwischen 1 und 365 Tagen liegen."
      ),
    // The QR bill rejects debtor names longer than 70 characters (swissqrbill validator).
    billingName: optionalText(70, "Name"),
    billingStreet: optionalText(ADDRESS_LIMITS.street, "Strasse"),
    billingHouseNumber: optionalText(ADDRESS_LIMITS.houseNumber, "Hausnummer"),
    billingZipCode: optionalText(ADDRESS_LIMITS.zip, "PLZ"),
    billingCity: optionalText(ADDRESS_LIMITS.city, "Ort"),
    billingCountry: z.string().nullable().refine((v) => v === null || isCountryCode(v), "Ungültiger Ländercode."),
    billingEmail: z.string().email("Ungültige E-Mail-Adresse.").nullable(),
  })
  .superRefine((value, ctx) => {
    const parts = [value.billingStreet, value.billingZipCode, value.billingCity];
    const filledCount = parts.filter(Boolean).length;
    if (filledCount > 0 && filledCount < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["billingStreet"],
        message: "Strasse, PLZ und Ort der Rechnungsadresse müssen zusammen ausgefüllt werden.",
      });
    }
  });

function text(formData: FormData, key: string): string | null {
  return ((formData.get(key) as string) || "").trim() || null;
}

function readCustomerForm(formData: FormData) {
  return {
    company: (formData.get("company") as string) || null,
    contactPerson: (formData.get("contactPerson") as string) || "",
    street: ((formData.get("street") as string) || "").trim(),
    houseNumber: text(formData, "houseNumber"),
    city: ((formData.get("city") as string) || "").trim(),
    zipCode: ((formData.get("zipCode") as string) || "").trim(),
    country: ((formData.get("country") as string) || "CH").trim().toUpperCase(),
    email: (formData.get("email") as string) || "",
    phone: (formData.get("phone") as string) || null,
    customerNumber: text(formData, "customerNumber"),
    uid: text(formData, "uid"),
    paymentTermDays: text(formData, "paymentTermDays"),
    billingName: text(formData, "billingName"),
    billingStreet: text(formData, "billingStreet"),
    billingHouseNumber: text(formData, "billingHouseNumber"),
    billingZipCode: text(formData, "billingZipCode"),
    billingCity: text(formData, "billingCity"),
    billingCountry: text(formData, "billingCountry")?.toUpperCase() ?? null,
    billingEmail: text(formData, "billingEmail"),
  };
}

type ParsedCustomer = z.infer<typeof customerSchema>;

/** All text fields as submitted (a ticked checkbox is "on"; unticked ones are absent). */
function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function validate(formData: FormData):
  | { ok: true; data: ParsedCustomer }
  | { ok: false; state: CustomerFormState } {
  const parsed = customerSchema.safeParse(readCustomerForm(formData));
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as string;
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return {
    ok: false,
    state: { error: "Bitte alle Pflichtfelder korrekt ausfüllen.", fieldErrors, values: submittedValues(formData) },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

function duplicateNumber(formData: FormData): CustomerFormState {
  return {
    error: "Bitte alle Pflichtfelder korrekt ausfüllen.",
    fieldErrors: { customerNumber: "Kundennummer bereits vergeben." },
    values: submittedValues(formData),
  };
}

/** Columns shared by create and update (everything except the customer number). */
function customerData(d: ParsedCustomer, formData: FormData) {
  const hasBilling = Boolean(d.billingStreet && d.billingZipCode && d.billingCity);
  return {
    company: d.company || null,
    contactPerson: d.contactPerson,
    street: d.street,
    houseNumber: d.houseNumber,
    city: d.city,
    zipCode: d.zipCode,
    country: d.country,
    // Saving confirms the address, e.g. after the migration's automatic split.
    addressNeedsReview: false,
    email: d.email,
    phone: d.phone || null,
    contactInsteadOfCompany: formData.get("contactInsteadOfCompany") === "on",
    uid: d.uid ? normalizeUid(d.uid) : null,
    paymentTermDays: d.paymentTermDays ? Number(d.paymentTermDays) : null,
    // A billing name or country without an address would be meaningless.
    billingName: hasBilling ? d.billingName : null,
    billingStreet: hasBilling ? d.billingStreet : null,
    billingHouseNumber: hasBilling ? d.billingHouseNumber : null,
    billingZipCode: hasBilling ? d.billingZipCode : null,
    billingCity: hasBilling ? d.billingCity : null,
    billingCountry: hasBilling ? (d.billingCountry ?? "CH") : null,
    billingEmail: d.billingEmail,
  };
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const result = validate(formData);
  if (!result.ok) return result.state;
  const data = customerData(result.data, formData);

  const explicitNumber = result.data.customerNumber ? Number(result.data.customerNumber) : null;
  let customer: { customerId: number } | undefined;
  // Automatic numbers race with concurrent creates: recompute and retry on a collision.
  for (let attempt = 0; attempt < 3 && !customer; attempt++) {
    const customerNumber = explicitNumber ?? (await nextCustomerNumber(prisma));
    try {
      customer = await prisma.customer.create({ data: { ...data, customerNumber } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (explicitNumber !== null) return duplicateNumber(formData);
    }
  }
  if (!customer) {
    return {
      error: "Kundennummer konnte nicht vergeben werden. Bitte erneut versuchen.",
      values: submittedValues(formData),
    };
  }

  await logAudit(session, "CREATE", "Customer", customer.customerId, result.data.contactPerson);

  redirect("/customers");
}

export async function updateCustomer(
  id: number,
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const result = validate(formData);
  if (!result.ok) return result.state;
  const data = customerData(result.data, formData);
  // The customer number is fixed after creation: archived PDFs and sent documents carry it.
  await prisma.customer.update({ where: { customerId: id }, data });
  await logAudit(session, "UPDATE", "Customer", id, result.data.contactPerson);
  // Top-customer names come from the cached analytics payload.
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  redirect(`/customers/${id}`);
}

export async function deleteCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  // Invoices are booking records: they stay, so the customer is archived instead.
  const invoiceCount = await prisma.invoice.count({ where: { customerId: id } });
  if (invoiceCount > 0) {
    return { error: "Der Kunde hat Rechnungen und kann nicht gelöscht werden. Bitte archivieren." };
  }
  await prisma.customer.delete({ where: { customerId: id } });
  await logAudit(session, "DELETE", "Customer", id);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/customers");
}

export async function archiveCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  await prisma.customer.update({ where: { customerId: id }, data: { archivedAt: new Date() } });
  await logAudit(session, "UPDATE", "Customer", id, undefined, { archived: true });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}

export async function restoreCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  await prisma.customer.update({ where: { customerId: id }, data: { archivedAt: null } });
  await logAudit(session, "UPDATE", "Customer", id, undefined, { archived: false });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}
