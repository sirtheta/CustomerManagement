import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// deleteCustomer against a real database: quotes cascade with the customer, so
// their items must go too (Item.quote is SET NULL and would leave orphans).
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

import { deleteCustomer } from "@/app/(app)/customers/actions";

describe("deleteCustomer (real database)", () => {
  const db = createTestDatabase();

  beforeEach(() => {
    holder.prisma = db.prisma;
    holder.session = { user: { id: "1", name: "Admin", email: "a@test.ch", role: "Admin" }, expires: "2099-01-01" } as Session;
  });

  const quoteWithItem = (customerId: number, name: string) =>
    db.prisma.quote.create({
      data: {
        customerId,
        date: new Date("2026-06-01"),
        validUntil: new Date("2026-07-01"),
        totalAmount: 10,
        state: "Draft",
        items: { create: [{ name, unit: "Piece", unitPrice: 10, quantity: 1, totalAmount: 10 }] },
      },
    });

  it("deletes the quotes' items with the customer and keeps the items of other customers", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const other = await db.prisma.customer.create({ data: { ...createValidTestCustomer(), contactPerson: "Anderer" } });
    await quoteWithItem(customer.customerId, "Weg");
    await quoteWithItem(other.customerId, "Bleibt");

    await expect(deleteCustomer(customer.customerId)).rejects.toThrow("redirect /customers");

    expect(await db.prisma.customer.findUnique({ where: { customerId: customer.customerId } })).toBeNull();
    expect(await db.prisma.quote.count({ where: { customerId: customer.customerId } })).toBe(0);
    expect((await db.prisma.item.findMany()).map((i) => i.name)).toEqual(["Bleibt"]);
    expect(await db.prisma.item.count({ where: { invoiceId: null, quoteId: null } })).toBe(0);
  });
});
