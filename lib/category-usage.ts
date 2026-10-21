import type { PrismaClient } from "@prisma/client";

type Client = Pick<PrismaClient, "item" | "service" | "expense" | "templateItem">;

export type CategoryUsage = {
  items: number;
  services: number;
  expenses: number;
  templateItems: number;
};

export function totalCategoryUsage(usage: CategoryUsage): number {
  return usage.items + usage.services + usage.expenses + usage.templateItems;
}

// `TemplateItem.categoryId` has no relation, so a plain count is the only way to see it.
export async function countCategoryUsage(client: Client, categoryId: number): Promise<CategoryUsage> {
  const [items, services, expenses, templateItems] = await Promise.all([
    client.item.count({ where: { categoryId } }),
    client.service.count({ where: { categoryId } }),
    client.expense.count({ where: { categoryId } }),
    client.templateItem.count({ where: { categoryId } }),
  ]);
  return { items, services, expenses, templateItems };
}

export async function loadCategoryUsageTotals(client: Client): Promise<Map<number, number>> {
  const [items, services, expenses, templateItems] = await Promise.all([
    client.item.groupBy({ by: ["categoryId"], where: { categoryId: { not: null } }, _count: { _all: true } }),
    client.service.groupBy({ by: ["categoryId"], where: { categoryId: { not: null } }, _count: { _all: true } }),
    client.expense.groupBy({ by: ["categoryId"], where: { categoryId: { not: null } }, _count: { _all: true } }),
    client.templateItem.groupBy({ by: ["categoryId"], where: { categoryId: { not: null } }, _count: { _all: true } }),
  ]);
  const totals = new Map<number, number>();
  for (const rows of [items, services, expenses, templateItems]) {
    for (const row of rows) {
      if (row.categoryId === null) continue;
      totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + row._count._all);
    }
  }
  return totals;
}
