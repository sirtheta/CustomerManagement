import type { Unit } from "@prisma/client";
import type { ItemData } from "@/components/items-editor-schema";
import { calculateInvoiceTotal, calculateItemTotal, type TotalOptions } from "@/lib/calculations";
import { isTimeUnit } from "@/lib/work-entries";

/**
 * Pure: turns recorded entries into invoice positions. Entries of one catalog service become one
 * line priced from the catalog; entries without a (still existing) service, or whose service now has
 * another unit, are grouped by name and unit and get price 0, to be filled in the draft. No Prisma,
 * so the billing form can preview it.
 */

export type BillableEntry = {
  id: number;
  /** A Date (UTC midnight) or `YYYY-MM-DD`. */
  date: Date | string;
  serviceId: number | null;
  name: string;
  unit: Unit;
  quantity: number;
};

export type BillableService = {
  name: string;
  description: string | null;
  unit: Unit;
  unitPrice: number;
  categoryId: number | null;
};

export type BillingLine = {
  key: string;
  name: string;
  description: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  categoryId: number | null;
  priceMissing: boolean;
  entryIds: number[];
};

function dayOf(date: Date | string): string {
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

/** `2026-10-12` to `12.10.` */
function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}.${month}.`;
}

export function buildBillingLines(
  entries: BillableEntry[],
  services: Record<number, BillableService>
): BillingLine[] {
  const groups = new Map<string, { entries: BillableEntry[]; service: BillableService | null }>();
  for (const entry of entries) {
    const catalog = entry.serviceId == null ? null : (services[entry.serviceId] ?? null);
    // If the catalog unit changed after recording, hours must not be billed as days (or pieces) at the
    // new price: such an entry is treated like free text and priced in the draft.
    const service = catalog && catalog.unit === entry.unit ? catalog : null;
    const key = service ? `s:${entry.serviceId}` : `t:${entry.unit}:${entry.name.trim().toLowerCase()}`;
    const group = groups.get(key) ?? { entries: [], service };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const lines = [...groups.entries()].map(([key, { entries: grouped, service }]): BillingLine => {
    // Whole hundredths, because quantities have at most two decimals and 0.1 + 0.2 must be 0.3.
    const quantity = grouped.reduce((sum, e) => sum + Math.round(e.quantity * 100), 0) / 100;
    const unitPrice = service?.unitPrice ?? 0;
    const days = [...new Set(grouped.map((e) => dayOf(e.date)))].sort().map(formatDay);
    return {
      key,
      name: service?.name ?? grouped[0].name.trim(),
      description: [
        service?.description?.trim(),
        `${isTimeUnit(service?.unit ?? grouped[0].unit) ? "Einsatztage" : "Geliefert am"}: ${days.join(", ")}`,
      ].filter(Boolean).join("\n"),
      unit: service?.unit ?? grouped[0].unit,
      quantity,
      unitPrice,
      totalAmount: calculateItemTotal({ quantity, unitPrice, discountPercent: 0 }),
      categoryId: service?.categoryId ?? null,
      // Only lines without a usable catalog service: a catalog service that is free (price 0) is not "missing".
      priceMissing: service === null,
      entryIds: grouped.map((e) => e.id),
    };
  });

  // Time before material; the sort is stable, so the order of first use stays within each part.
  return lines.sort((a, b) => Number(!isTimeUnit(a.unit)) - Number(!isTimeUnit(b.unit)));
}

/** Invoice total without discount; the 5-Rappen rounding applies to the total only, as everywhere. */
export function billingTotal(lines: BillingLine[], options: TotalOptions = {}): number {
  return calculateInvoiceTotal(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    0,
    options
  );
}

export function toItemData(line: BillingLine): ItemData {
  return {
    name: line.name,
    description: line.description,
    unit: line.unit,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    discountPercent: 0,
    totalAmount: line.totalAmount,
    customText: "",
    categoryId: line.categoryId,
  };
}
