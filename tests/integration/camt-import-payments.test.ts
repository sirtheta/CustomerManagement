import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The action under test uses the default prisma singleton (also inside
// lib/payments). Route it to the per-suite test database via a proxy.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    { get: (_t, prop) => (holder.prisma as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => ({
    user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" },
  })),
  requireAdmin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { markInvoicesPaidFromImport } from "@/app/(app)/invoices/actions";

describe("markInvoicesPaidFromImport (CAMT import) against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(state: "Sent" | "Paid" | "Draft" = "Sent", total = 100) {
    holder.prisma = db.prisma;
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
        paidDate: state === "Paid" ? new Date("2026-02-01") : null,
      },
    });
  }

  it("books a partial payment, ignores a duplicate confirmation, and completes with the rest", async () => {
    const inv = await seedInvoice();
    const first = {
      invoiceId: inv.id,
      paidDate: "2026-03-01",
      amountCents: 4000,
      bankReference: "REF-A",
    };

    expect(await markInvoicesPaidFromImport([first])).toEqual({ paidCount: 1 });
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("PartiallyPaid");
    let payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toNumber()).toBe(40);
    expect(payments[0].source).toBe("camt-import");
    expect(payments[0].bankReference).toBe("REF-A");

    // Same bank entry confirmed again (second tab / re-upload).
    expect(await markInvoicesPaidFromImport([first])).toEqual({ paidCount: 0 });
    payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1);

    const second = {
      invoiceId: inv.id,
      paidDate: "2026-03-15",
      amountCents: 6000,
      bankReference: "REF-B",
    };
    expect(await markInvoicesPaidFromImport([second])).toEqual({ paidCount: 1 });
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("Paid");
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it.each(["Paid", "Draft"] as const)("skips a %s invoice", async (state) => {
    const inv = await seedInvoice(state);

    const result = await markInvoicesPaidFromImport([
      { invoiceId: inv.id, paidDate: "2026-03-01", amountCents: 10000, bankReference: "REF-X" },
    ]);

    expect(result).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(0);
  });
});
