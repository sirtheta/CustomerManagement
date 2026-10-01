import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { nextCustomerNumber } from "@/lib/customer-number";

describe("nextCustomerNumber", () => {
  const db = createTestDatabase();

  it("starts at 1001", async () => {
    expect(await nextCustomerNumber(db.prisma)).toBe(1001);
  });

  it("continues after the highest number, ignoring customers without one", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: createValidTestCustomer() }); // no number
    await prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 2500 } });
    expect(await nextCustomerNumber(prisma)).toBe(2501);
  });

  it("enforces uniqueness", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 5 } });
    await expect(
      prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 5 } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows many customers without a number", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: createValidTestCustomer() });
    await prisma.customer.create({ data: createValidTestCustomer() });
    expect(await prisma.customer.count()).toBe(2);
  });

  it("deletes contacts together with the customer", async () => {
    const { prisma } = db;
    const c = await prisma.customer.create({
      data: { ...createValidTestCustomer(), contacts: { create: [{ name: "Buchhaltung" }] } },
    });
    expect(await prisma.customerContact.count()).toBe(1);
    await prisma.customer.delete({ where: { customerId: c.customerId } });
    expect(await prisma.customerContact.count()).toBe(0);
  });
});
