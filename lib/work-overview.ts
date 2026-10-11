import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { isTimeUnit } from "@/lib/work-entries";

export type OpenWorkRow = {
  customerId: number;
  customerName: string;
  /** Archived customers keep their open entries; they cannot be billed until the customer is restored. */
  archived: boolean;
  entryCount: number;
  hours: number;
  days: number;
  materialCount: number;
  /** `YYYY-MM-DD` of the oldest open entry. */
  oldest: string;
};

/** Customers with entries that are not billed yet, sorted by name. */
export async function listOpenWork(db: Pick<PrismaClient, "workEntry">): Promise<OpenWorkRow[]> {
  const entries = await db.workEntry.findMany({
    where: { invoiceId: null },
    include: { customer: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const rows = new Map<number, OpenWorkRow>();
  for (const e of entries) {
    const row = rows.get(e.customerId) ?? {
      customerId: e.customerId,
      customerName: customerDisplayName(e.customer),
      archived: e.customer.archivedAt !== null,
      entryCount: 0,
      hours: 0,
      days: 0,
      materialCount: 0,
      oldest: e.date.toISOString().slice(0, 10), // entries are sorted by date, so the first one is the oldest
    };
    row.entryCount += 1;
    const quantity = Number(e.quantity);
    if (e.unit === "Hour") row.hours = Math.round((row.hours + quantity) * 100) / 100;
    else if (e.unit === "Day") row.days = Math.round((row.days + quantity) * 100) / 100;
    if (!isTimeUnit(e.unit)) row.materialCount += 1;
    rows.set(e.customerId, row);
  }
  return [...rows.values()].sort((a, b) => a.customerName.localeCompare(b.customerName, "de-CH"));
}
