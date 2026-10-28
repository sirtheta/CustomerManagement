"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Unit } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { parseDecimalInput } from "@/lib/decimal-input";
import { logAudit } from "@/lib/audit";

export type ServiceFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createService(
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const session = await requireEditor();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;
  const unit = formData.get("unit") as Unit;
  const unitPriceRaw = formData.get("unitPrice") as string;
  const isActive = formData.get("isActive") === "on";
  const categoryIdRaw = formData.get("categoryId") as string | null;

  if (!name || !unit || !unitPriceRaw) {
    const fieldErrors: Record<string, string> = {};
    if (!name) fieldErrors.name = "Bezeichnung ist erforderlich.";
    if (!unit) fieldErrors.unit = "Einheit ist erforderlich.";
    if (!unitPriceRaw) fieldErrors.unitPrice = "Preis ist erforderlich.";
    return { error: "Bitte alle Pflichtfelder ausfüllen.", fieldErrors };
  }

  const unitPrice = parseDecimalInput(unitPriceRaw);
  if (isNaN(unitPrice) || unitPrice < 0) {
    return { error: "Ungültiger Preis.", fieldErrors: { unitPrice: "Bitte einen Preis wie 85.50 oder 85,50 eingeben." } };
  }

  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? parseInt(categoryIdRaw, 10) : null;

  const service = await prisma.service.create({
    data: {
      name,
      description: description || null,
      unit,
      unitPrice,
      isActive,
      categoryId,
    },
  });

  await logAudit(session, "CREATE", "Service", service.id, service.name);
  redirect("/services?flash=service-created");
}

export async function updateService(
  id: number,
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const session = await requireEditor();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;
  const unit = formData.get("unit") as Unit;
  const unitPriceRaw = formData.get("unitPrice") as string;
  const isActive = formData.get("isActive") === "on";
  const categoryIdRaw = formData.get("categoryId") as string | null;

  if (!name || !unit || !unitPriceRaw) {
    const fieldErrors: Record<string, string> = {};
    if (!name) fieldErrors.name = "Bezeichnung ist erforderlich.";
    if (!unit) fieldErrors.unit = "Einheit ist erforderlich.";
    if (!unitPriceRaw) fieldErrors.unitPrice = "Preis ist erforderlich.";
    return { error: "Bitte alle Pflichtfelder ausfüllen.", fieldErrors };
  }

  const unitPrice = parseDecimalInput(unitPriceRaw);
  if (isNaN(unitPrice) || unitPrice < 0) {
    return { error: "Ungültiger Preis.", fieldErrors: { unitPrice: "Bitte einen Preis wie 85.50 oder 85,50 eingeben." } };
  }

  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? parseInt(categoryIdRaw, 10) : null;

  await prisma.service.update({
    where: { id },
    data: {
      name,
      description: description || null,
      unit,
      unitPrice,
      isActive,
      categoryId,
    },
  });

  await logAudit(session, "UPDATE", "Service", id, name);
  redirect("/services?flash=service-updated");
}

export async function deleteService(id: number): Promise<void> {
  const session = await requireAdmin();
  const service = await prisma.service.findUnique({ where: { id }, select: { name: true } });
  // WorkEntry.service is SET NULL: open entries stay but lose their catalog price, so the audit entry records how many.
  const openWorkEntries = await prisma.workEntry.count({ where: { serviceId: id, invoiceId: null } });
  await prisma.service.delete({ where: { id } });
  await logAudit(session, "DELETE", "Service", id, service?.name, openWorkEntries > 0 ? { openWorkEntries } : undefined);
  redirect("/services?flash=service-deleted");
}
