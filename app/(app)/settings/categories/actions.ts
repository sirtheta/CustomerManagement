"use server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { revalidatePath, revalidateTag } from "next/cache";
import { logAudit } from "@/lib/audit";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { countCategoryUsage, totalCategoryUsage } from "@/lib/category-usage";
import { Prisma } from "@prisma/client";

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
  // Category names/colours are baked into the cached analytics payload.
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}

export async function deleteCategory(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const category = await prisma.category.findUnique({ where: { categoryId: id } });
  if (!category) return { error: "Kategorie nicht gefunden." };

  // Deleting a used category would silently set it to null on old invoices and expenses and
  // shift past analytics to «Ohne Kategorie»; those stay on «Inaktiv».
  const usage = await countCategoryUsage(prisma, id);
  if (totalCategoryUsage(usage) > 0) {
    return { error: "Die Kategorie wird noch verwendet und kann nicht gelöscht werden. Setzen Sie sie auf inaktiv." };
  }

  try {
    await prisma.category.delete({ where: { categoryId: id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { error: "Kategorie nicht gefunden." };
    }
    throw error;
  }
  await logAudit(session, "DELETE", "Settings", id, category.name);
  revalidatePath("/settings/categories");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}
