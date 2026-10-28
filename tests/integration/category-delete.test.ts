import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase } from "../test-utils";

// deleteCategory against a real database: a used category must stay, because the relations
// are SET NULL and a delete would move old invoices and expenses to «Ohne Kategorie».
const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect ${url}`);
  }),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { deleteCategory } from "@/app/(app)/settings/categories/actions";
import { loadCategoryUsageTotals } from "@/lib/category-usage";

const USED_ERROR = "Die Kategorie wird noch verwendet und kann nicht gelöscht werden. Setze sie auf inaktiv.";

describe("deleteCategory (real database)", () => {
  const db = createTestDatabase();

  beforeEach(() => {
    holder.prisma = db.prisma;
    holder.session = { user: { id: "1", name: "Admin", email: "a@test.ch", role: "Admin" }, expires: "2099-01-01" } as Session;
  });

  const category = (name: string) => db.prisma.category.create({ data: { name } });

  it("deletes an unused category", async () => {
    const c = await category("Unbenutzt");

    expect(await deleteCategory(c.categoryId)).toEqual({});

    expect(await db.prisma.category.count({ where: { categoryId: c.categoryId } })).toBe(0);
  });

  it("refuses a category that a service uses", async () => {
    const c = await category("Leistung");
    await db.prisma.service.create({ data: { name: "S", unit: "Hour", unitPrice: 100, categoryId: c.categoryId } });

    expect(await deleteCategory(c.categoryId)).toEqual({ error: USED_ERROR });

    expect(await db.prisma.category.count({ where: { categoryId: c.categoryId } })).toBe(1);
  });

  it("refuses a category that an expense uses", async () => {
    const c = await category("Ausgabe");
    await db.prisma.expense.create({
      data: { date: new Date("2026-06-01"), description: "E", amount: 10, categoryId: c.categoryId },
    });

    expect(await deleteCategory(c.categoryId)).toEqual({ error: USED_ERROR });
  });

  it("refuses a category that only a template item uses", async () => {
    const c = await category("Vorlage");
    await db.prisma.invoiceTemplate.create({
      data: {
        name: "T",
        items: { create: [{ name: "P", unit: "Piece", unitPrice: 1, quantity: 1, categoryId: c.categoryId }] },
      },
    });

    expect(await deleteCategory(c.categoryId)).toEqual({ error: USED_ERROR });
    expect(await db.prisma.category.count({ where: { categoryId: c.categoryId } })).toBe(1);
  });

  it("reports a missing category", async () => {
    expect(await deleteCategory(99999)).toEqual({ error: "Kategorie nicht gefunden." });
  });

  it("counts usage over all four tables per category", async () => {
    const used = await category("Benutzt");
    const free = await category("Frei");
    await db.prisma.service.create({ data: { name: "S", unit: "Hour", unitPrice: 1, categoryId: used.categoryId } });
    await db.prisma.expense.create({
      data: { date: new Date("2026-06-01"), description: "E", amount: 1, categoryId: used.categoryId },
    });

    const totals = await loadCategoryUsageTotals(db.prisma);

    expect(totals.get(used.categoryId)).toBe(2);
    expect(totals.get(free.categoryId)).toBeUndefined();
  });
});
