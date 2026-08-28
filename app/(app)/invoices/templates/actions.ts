"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import type { ActionState } from "@/hooks/use-action-toast";
import { saveItemsToCatalog } from "@/lib/service-catalog";

export async function saveAsTemplate(
  invoiceId: number,
  name: string
): Promise<ActionState> {
  await requireEditor();
  if (!name.trim()) return { error: "Bitte einen Namen für die Vorlage angeben." };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });
  if (!invoice) return { error: "Rechnung nicht gefunden." };
  if (invoice.items.length === 0) return { error: "Die Rechnung hat keine Positionen." };

  await prisma.invoiceTemplate.create({
    data: {
      name: name.trim(),
      items: {
        create: invoice.items.map((item) => ({
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          categoryId: item.categoryId,
        })),
      },
    },
  });

  revalidatePath("/invoices/templates");
  return { success: true, _ts: Date.now() };
}

export async function createTemplate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireEditor();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Bitte einen Namen angeben." };

  await prisma.invoiceTemplate.create({ data: { name } });
  revalidatePath("/invoices/templates");
  return { success: true, _ts: Date.now() };
}

export async function updateTemplate(
  id: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireEditor();
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Bitte einen Namen angeben." };

  const itemsJson = formData.get("itemsJson") as string;
  const { itemDataSchema } = await import("@/components/items-editor-schema");
  const items = itemDataSchema.array().parse(JSON.parse(itemsJson || "[]"));

  await prisma.$transaction(async (tx) => {
    await tx.templateItem.deleteMany({ where: { templateId: id } });
    await saveItemsToCatalog(tx, items);
    await tx.invoiceTemplate.update({
      where: { id },
      data: {
        name,
        items: {
          create: items.map((item) => ({
            name: item.name,
            description: item.description || null,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            categoryId: item.categoryId,
          })),
        },
      },
    });
  });

  revalidatePath("/invoices/templates");
  return { success: true, _ts: Date.now() };
}

export async function deleteTemplate(id: number): Promise<ActionState> {
  await requireAdmin();
  await prisma.invoiceTemplate.delete({ where: { id } });
  revalidatePath("/invoices/templates");
  return { success: true, _ts: Date.now() };
}
