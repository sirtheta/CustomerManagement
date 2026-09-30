import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("documents without a number", () => {
  const db = createTestDatabase();

  it("allows several invoice drafts without a documentNumber", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const base = {
      customerId: customer.customerId,
      date: new Date(),
      dueDate: new Date(),
      totalAmount: 100,
      state: "Draft" as const,
    };
    await db.prisma.invoice.create({ data: base });
    await db.prisma.invoice.create({ data: base });

    const drafts = await db.prisma.invoice.findMany({ where: { documentNumber: null } });
    expect(drafts).toHaveLength(2);
  });

  it("allows several quote drafts without a documentNumber", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const base = {
      customerId: customer.customerId,
      date: new Date(),
      validUntil: new Date(),
      totalAmount: 100,
      state: "Draft" as const,
    };
    await db.prisma.quote.create({ data: base });
    await db.prisma.quote.create({ data: base });

    const drafts = await db.prisma.quote.findMany({ where: { documentNumber: null } });
    expect(drafts).toHaveLength(2);
  });
});
