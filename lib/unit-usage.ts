import type { PrismaClient, Unit } from "@prisma/client";
import { sortUnitsByUsage } from "@/lib/units";

type Client = Pick<PrismaClient, "item" | "service" | "templateItem">;

/**
 * The units in the order the dropdowns show them: most used first, counted over document items,
 * template items and catalog services. Work entries are left out on purpose, their unit comes from
 * the service and would count it twice.
 */
export async function loadUnitOrder(client: Client): Promise<Unit[]> {
  const [items, services, templateItems] = await Promise.all([
    client.item.groupBy({ by: ["unit"], _count: { _all: true } }),
    client.service.groupBy({ by: ["unit"], _count: { _all: true } }),
    client.templateItem.groupBy({ by: ["unit"], _count: { _all: true } }),
  ]);
  const counts = new Map<Unit, number>();
  for (const rows of [items, services, templateItems]) {
    for (const row of rows) counts.set(row.unit, (counts.get(row.unit) ?? 0) + row._count._all);
  }
  return sortUnitsByUsage(counts);
}
