"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export type CustomerFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const customerSchema = z.object({
  company: z.string().nullable(),
  contactPerson: z.string().min(1, "Kontaktperson ist erforderlich."),
  address: z.string().min(1, "Adresse ist erforderlich."),
  city: z.string().min(1, "Ort ist erforderlich."),
  zipCode: z.string().min(1, "PLZ ist erforderlich."),
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
    address: (formData.get("address") as string) || "",
    city: (formData.get("city") as string) || "",
    zipCode: (formData.get("zipCode") as string) || "",
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

  const { company, contactPerson, address, city, zipCode, email, phone } = parsed.data;
  const yearlyInvoice = formData.get("yearlyInvoice") === "on";
  const contactInsteadOfCompany = formData.get("contactInsteadOfCompany") === "on";
  const nextInvoiceDateRaw = formData.get("nextInvoiceDate") as string | null;
  const nextInvoiceDate = yearlyInvoice && nextInvoiceDateRaw ? new Date(nextInvoiceDateRaw) : null;

  const customer = await prisma.customer.create({
    data: {
      company: company || null,
      contactPerson,
      address,
      city,
      zipCode,
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
    address: (formData.get("address") as string) || "",
    city: (formData.get("city") as string) || "",
    zipCode: (formData.get("zipCode") as string) || "",
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

  const { company, contactPerson, address, city, zipCode, email, phone } = parsed.data;
  const yearlyInvoice = formData.get("yearlyInvoice") === "on";
  const contactInsteadOfCompany = formData.get("contactInsteadOfCompany") === "on";
  const nextInvoiceDateRaw = formData.get("nextInvoiceDate") as string | null;
  const nextInvoiceDate = yearlyInvoice && nextInvoiceDateRaw ? new Date(nextInvoiceDateRaw) : null;

  await prisma.customer.update({
    where: { customerId: id },
    data: {
      company: company || null,
      contactPerson,
      address,
      city,
      zipCode,
      email,
      phone: phone || null,
      yearlyInvoice,
      contactInsteadOfCompany,
      nextInvoiceDate,
    },
  });
  await logAudit(session, "UPDATE", "Customer", id, contactPerson);

  redirect(`/customers/${id}`);
}

export async function deleteCustomer(id: number): Promise<void> {
  const session = await requireAdmin();
  await prisma.customer.delete({ where: { customerId: id } });
  await logAudit(session, "DELETE", "Customer", id);
  redirect("/customers");
}
