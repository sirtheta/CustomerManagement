"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Unit } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";

export type ServiceFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createService(
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  await requireEditor();
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

  const unitPrice = parseFloat(unitPriceRaw);
  if (isNaN(unitPrice) || unitPrice < 0) {
    return { error: "Ungültiger Preis.", fieldErrors: { unitPrice: "Preis muss eine nicht-negative Zahl sein." } };
  }

  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? parseInt(categoryIdRaw, 10) : null;

  await prisma.service.create({
    data: {
      name,
      description: description || null,
      unit,
      unitPrice,
      isActive,
      categoryId,
    },
  });

  redirect("/services");
}

export async function updateService(
  id: number,
  _prev: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  await requireEditor();
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

  const unitPrice = parseFloat(unitPriceRaw);
  if (isNaN(unitPrice) || unitPrice < 0) {
    return { error: "Ungültiger Preis.", fieldErrors: { unitPrice: "Preis muss eine nicht-negative Zahl sein." } };
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

  redirect("/services");
}

export async function deleteService(id: number): Promise<void> {
  await requireAdmin();
  await prisma.service.delete({ where: { id } });
  redirect("/services");
}
