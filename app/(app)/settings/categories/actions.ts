"use server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

export type CategoryFormState = {
  error?: string;
};

export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const session = await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const colorHex = (formData.get("colorHex") as string)?.trim();

  if (!name) {
    return { error: "Bezeichnung ist erforderlich." };
  }

  const category = await prisma.category.create({
    data: { name, colorHex: colorHex || null },
  });
  await logAudit(session, "CREATE", "Settings", category.categoryId, category.name);
  revalidatePath("/settings/categories");
  return {};
}

export async function updateCategory(
  id: number,
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const session = await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  const colorHex = (formData.get("colorHex") as string)?.trim();
  const isActive = formData.get("isActive") === "on";

  if (!name) {
    return { error: "Bezeichnung ist erforderlich." };
  }

  const category = await prisma.category.update({
    where: { categoryId: id },
    data: { name, colorHex: colorHex || null, isActive },
  });
  await logAudit(session, "UPDATE", "Settings", id, category.name);
  revalidatePath("/settings/categories");
  return {};
}
