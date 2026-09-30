"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { ADDRESS_LIMITS, isCountryCode } from "@/lib/address";

export type CustomerFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const customerSchema = z.object({
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
});

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const raw = {
    company: (formData.get("company") as string) || null,
    contactPerson: (formData.get("contactPerson") as string) || "",
    street: ((formData.get("street") as string) || "").trim(),
    houseNumber: ((formData.get("houseNumber") as string) || "").trim() || null,
    city: ((formData.get("city") as string) || "").trim(),
    zipCode: ((formData.get("zipCode") as string) || "").trim(),
    country: ((formData.get("country") as string) || "CH").trim().toUpperCase(),
    email: (formData.get("email") as string) || "",
    phone: (formData.get("phone") as string) || null,
  };

  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as string;
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { error: "Bitte alle Pflichtfelder korrekt ausfüllen.", fieldErrors };
  }

  const { company, contactPerson, street, houseNumber, city, zipCode, country, email, phone } =
    parsed.data;
  const yearlyInvoice = formData.get("yearlyInvoice") === "on";
  const contactInsteadOfCompany = formData.get("contactInsteadOfCompany") === "on";
  const nextInvoiceDateRaw = formData.get("nextInvoiceDate") as string | null;
  const nextInvoiceDate = yearlyInvoice && nextInvoiceDateRaw ? new Date(nextInvoiceDateRaw) : null;

  const customer = await prisma.customer.create({
    data: {
      company: company || null,
      contactPerson,
      street,
      houseNumber,
      city,
      zipCode,
      country,
      // Saving confirms the address, e.g. after the migration's automatic split.
      addressNeedsReview: false,
      email,
      phone: phone || null,
      yearlyInvoice,
      contactInsteadOfCompany,
      nextInvoiceDate,
    },
  });
  await logAudit(session, "CREATE", "Customer", customer.customerId, contactPerson);

  redirect("/customers");
}

export async function updateCustomer(
  id: number,
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const raw = {
    company: (formData.get("company") as string) || null,
    contactPerson: (formData.get("contactPerson") as string) || "",
    street: ((formData.get("street") as string) || "").trim(),
    houseNumber: ((formData.get("houseNumber") as string) || "").trim() || null,
    city: ((formData.get("city") as string) || "").trim(),
    zipCode: ((formData.get("zipCode") as string) || "").trim(),
    country: ((formData.get("country") as string) || "CH").trim().toUpperCase(),
    email: (formData.get("email") as string) || "",
    phone: (formData.get("phone") as string) || null,
  };

  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as string;
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { error: "Bitte alle Pflichtfelder korrekt ausfüllen.", fieldErrors };
  }

  const { company, contactPerson, street, houseNumber, city, zipCode, country, email, phone } =
    parsed.data;
  const yearlyInvoice = formData.get("yearlyInvoice") === "on";
  const contactInsteadOfCompany = formData.get("contactInsteadOfCompany") === "on";
  const nextInvoiceDateRaw = formData.get("nextInvoiceDate") as string | null;
  const nextInvoiceDate = yearlyInvoice && nextInvoiceDateRaw ? new Date(nextInvoiceDateRaw) : null;

  await prisma.customer.update({
    where: { customerId: id },
    data: {
      company: company || null,
      contactPerson,
      street,
      houseNumber,
      city,
      zipCode,
      country,
      // Saving confirms the address, e.g. after the migration's automatic split.
      addressNeedsReview: false,
      email,
      phone: phone || null,
      yearlyInvoice,
      contactInsteadOfCompany,
      nextInvoiceDate,
    },
  });
  await logAudit(session, "UPDATE", "Customer", id, contactPerson);
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
