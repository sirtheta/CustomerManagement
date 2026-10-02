import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The queries use the default prisma singleton; route it to the test database.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    { get: (_t, prop) => (holder.prisma as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import {
  fetchAnalyticsData,
  fetchDrilldownIncomeItems,
} from "@/app/(app)/analytics/lib/analytics-queries";

type ItemSpec = { name: string; total: number; categoryId: number | null };

describe("income by category follows the payments", () => {
  const db = createTestDatabase();

  async function seed() {
    holder.prisma = db.prisma;
    const prisma = db.prisma;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });
    const beratung = await prisma.category.create({ data: { name: "Beratung" } });
    const material = await prisma.category.create({ data: { name: "Material" } });
    let n = 0;

    async function invoice(
      state: "Sent" | "PartiallyPaid" | "Paid",
      totalAmount: number,
      items: ItemSpec[],
      extra: { discountPercent?: number; creditNoteForId?: number } = {}
    ) {
      return prisma.invoice.create({
        data: {
          customerId: customer.customerId,
          documentNumber: `R-${++n}`,
          date: new Date("2026-01-10T12:00:00Z"),
          dueDate: new Date("2026-02-10T12:00:00Z"),
          totalAmount,
          state,
          ...extra,
          items: {
            create: items.map((i) => ({
              name: i.name,
              unit: "Piece" as const,
              unitPrice: i.total,
              quantity: 1,
              totalAmount: i.total,
              categoryId: i.categoryId,
            })),
          },
        },
      });
    }
    async function pay(invoiceId: number, amount: number, date: string) {
      await prisma.payment.create({ data: { invoiceId, amount, date: new Date(`${date}T12:00:00Z`) } });
    }

    // 10 % invoice discount: total 90, paid in two parts.
    const discounted = await invoice("Paid", 90, [
      { name: "Workshop", total: 60, categoryId: beratung.categoryId },
      { name: "Unterlagen", total: 40, categoryId: material.categoryId },
    ], { discountPercent: 10 });
    await pay(discounted.id, 50, "2026-03-05");
    await pay(discounted.id, 40, "2026-05-02");

    // Partially paid, three equal items: 10.00 does not split evenly.
    const partial = await invoice("PartiallyPaid", 100, [
      { name: "A", total: 33.33, categoryId: beratung.categoryId },
      { name: "B", total: 33.33, categoryId: material.categoryId },
      { name: "C", total: 33.34, categoryId: null },
    ]);
    await pay(partial.id, 10, "2026-04-01");

    // Paid after a partial credit note: only the 80 actually received count.
    const credited = await invoice("Paid", 100, [
      { name: "Gerät", total: 100, categoryId: material.categoryId },
    ]);
    await invoice("Sent", -20, [
      { name: "Gutschrift Gerät", total: -20, categoryId: material.categoryId },
    ], { creditNoteForId: credited.id });
    await pay(credited.id, 80, "2026-06-01");

    // No items at all: the payment still counts, without a category.
    const empty = await invoice("Paid", 15, []);
    await pay(empty.id, 15, "2026-07-01");

    // Paid in the previous year: not part of 2026.
    const old = await invoice("Paid", 500, [
      { name: "Alt", total: 500, categoryId: beratung.categoryId },
    ]);
    await pay(old.id, 500, "2025-12-15");

    return { beratung, material };
  }

  it("splits every payment over the invoice items so the categories add up to the revenue", async () => {
    const { beratung, material } = await seed();

    const data = await fetchAnalyticsData(2026);
    expect(data.annualRevenue).toBe(195);

    const byCategory = Object.fromEntries(data.incomeByCategory.map((c) => [String(c.categoryId), c.total]));
    // discounted: 60/40 of 90; partial: 3.33/3.33/3.34; credited: 80; empty: 15
    expect(byCategory[String(beratung.categoryId)]).toBe(57.33);
    expect(byCategory[String(material.categoryId)]).toBe(119.33);
    expect(byCategory["null"]).toBe(18.34);

    const sumRappen = data.incomeByCategory.reduce((s, c) => s + Math.round(c.total * 100), 0);
    expect(sumRappen).toBe(Math.round(data.annualRevenue * 100));
    const monthlyRappen = data.monthlyRevenue.reduce((s, m) => s + Math.round(m.amount * 100), 0);
    expect(sumRappen).toBe(monthlyRappen);

    const combinedIncome = data.combinedByCategory.reduce((s, c) => s + Math.round(c.income * 100), 0);
    expect(combinedIncome).toBe(sumRappen);
  });

  it("drilldown rows add up to their category total", async () => {
    await seed();
    const data = await fetchAnalyticsData(2026);

    for (const category of data.incomeByCategory) {
      const rows = await fetchDrilldownIncomeItems(2026, category.categoryId);
      const rappen = rows.reduce((s, r) => s + Math.round(r.totalAmount * 100), 0);
      expect(rappen).toBe(Math.round(category.total * 100));
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    }

    const uncategorized = await fetchDrilldownIncomeItems(2026, null);
    expect(uncategorized.map((r) => [r.name, r.totalAmount]).sort()).toEqual([
      ["C", 3.34],
      ["Ohne Positionen", 15],
    ]);
  });
});
