import type { Prisma } from "@prisma/client";
import type { ItemData } from "@/components/items-editor-schema";

export async function saveItemsToCatalog(
  tx: Prisma.TransactionClient,
  items: ItemData[]
) {
  for (const item of items) {
    if (!item.isCustom || !item.saveToCatalog || !item.name.trim()) continue;

    await tx.service.create({
      data: {
        name: item.name.trim(),
        description: item.includeDescription ? item.description.trim() || null : null,
        unit: item.unit,
        unitPrice: item.unitPrice,
        isActive: true,
        categoryId: item.categoryId,
      },
    });
  }
}