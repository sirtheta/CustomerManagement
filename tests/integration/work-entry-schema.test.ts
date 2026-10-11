import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("WorkEntry schema", () => {
  const db = createTestDatabase();

  async function seed() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        date: new Date("2026-10-01"),
        dueDate: new Date("2026-10-31"),
        totalAmount: 0,
        state: "Draft",
      },
    });
    const entry = await db.prisma.workEntry.create({
      data: {
        customerId: customer.customerId,
        date: new Date("2026-10-01T00:00:00.000Z"),
        name: "Arbeitsstunde",
        unit: "Hour",
        quantity: 2.5,
        createdById: 1,
        invoiceId: invoice.id,
      },
    });
    return { customer, invoice, entry };
  }

  it("stores a decimal quantity", async () => {
    const { entry } = await seed();
    expect(Number(entry.quantity)).toBe(2.5);
  });

  it("frees the entry when its invoice is deleted (SetNull)", async () => {
    const { invoice, entry } = await seed();
    await db.prisma.invoice.delete({ where: { id: invoice.id } });
    const after = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.invoiceId).toBeNull();
  });

  it("keeps the entry name when its service is deleted (SetNull)", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const service = await db.prisma.service.create({
      data: { name: "Gartenpflege", unit: "Hour", unitPrice: 70 },
    });
    const entry = await db.prisma.workEntry.create({
      data: {
        customerId: customer.customerId,
        date: new Date("2026-10-01T00:00:00.000Z"),
        serviceId: service.id,
        name: "Gartenpflege",
        unit: "Hour",
        quantity: 1,
        createdById: 1,
      },
    });
    await db.prisma.service.delete({ where: { id: service.id } });
    const after = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.serviceId).toBeNull();
    expect(after.name).toBe("Gartenpflege");
  });

  it("refuses to delete a customer that only has entries (Restrict)", async () => {
    // No invoice here: the invoice of seed() would block the delete on its own.
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    await db.prisma.workEntry.create({
      data: {
        customerId: customer.customerId,
        date: new Date("2026-10-01T00:00:00.000Z"),
        name: "Arbeitsstunde",
        unit: "Hour",
        quantity: 1,
        createdById: 1,
      },
    });
    await expect(db.prisma.customer.delete({ where: { customerId: customer.customerId } })).rejects.toThrow();
  });

  it("defaults the module flag to on", async () => {
    const settings = await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    expect(settings.moduleTimeTracking).toBe(true);
  });
});
