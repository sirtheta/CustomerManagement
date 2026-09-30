import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { selectableCustomersWhere } from "@/lib/customer-archive";

describe("selectableCustomersWhere", () => {
  const db = createTestDatabase();

  it("hides archived customers except the one a draft already belongs to", async () => {
    const { prisma } = db;
    const active = await prisma.customer.create({ data: createValidTestCustomer() });
    const archived = await prisma.customer.create({
      data: { ...createValidTestCustomer(), contactPerson: "Archiv", archivedAt: new Date() },
    });

    const plain = await prisma.customer.findMany({ where: selectableCustomersWhere() });
    expect(plain.map((c) => c.customerId)).toEqual([active.customerId]);

    const withCurrent = await prisma.customer.findMany({
      where: selectableCustomersWhere(archived.customerId),
    });
    expect(withCurrent.map((c) => c.customerId).sort()).toEqual(
      [active.customerId, archived.customerId].sort()
    );
  });
});
