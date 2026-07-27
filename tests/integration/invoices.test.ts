import { describe, it, expect } from "vitest";
import {
  createTestDatabase,
  createValidTestCustomer,
  createValidItemList,
} from "../test-utils";

describe("InvoiceRepository", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  // Equivalent: BusinessDocumentRepository_AddInvoice_ShouldPersist
  it("should create an invoice with items", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060001",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 250,
        state: "Draft",
        items: { create: createValidItemList() },
      },
      include: { items: true },
    });

    expect(invoice.id).toBeGreaterThan(0);
    expect(invoice.items).toHaveLength(2);
    expect(Number(invoice.totalAmount)).toBe(250);
  });

  // Equivalent: BusinessDocumentRepository_GetInvoice_ShouldIncludeCustomerAndItems
  it("should retrieve invoice with customer and items", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const created = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060002",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Draft",
        items: { create: [createValidItemList()[0]] },
      },
    });

    const found = await prisma.invoice.findUnique({
      where: { id: created.id },
      include: { customer: true, items: true },
    });

    expect(found).not.toBeNull();
    expect(found!.customer.contactPerson).toBe("Test Person");
    expect(found!.items).toHaveLength(1);
  });

  // Equivalent: BusinessDocumentRepository_UpdateInvoiceState_ShouldPersist
  it("should update invoice state from Draft to Sent", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060003",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Draft",
      },
    });

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { state: "Sent" },
    });

    expect(updated.state).toBe("Sent");
  });

  it("should allow all valid invoice state transitions", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const base = {
      customerId: customer.customerId,
      date: new Date(),
      dueDate: new Date(Date.now() + 30 * 86_400_000),
      totalAmount: 100,
    };

    for (const state of ["Draft", "Sent", "Paid", "Overdue", "Canceled"] as const) {
      const inv = await prisma.invoice.create({
        data: { ...base, documentNumber: `I-${state}`, state },
      });
      expect(inv.state).toBe(state);
    }
  });

  it("should delete invoice and its items via item deleteMany", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060004",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 250,
        state: "Draft",
        items: { create: createValidItemList() },
      },
      include: { items: true },
    });

    await prisma.item.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.invoice.delete({ where: { id: invoice.id } });

    const found = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(found).toBeNull();
  });

  it("should store and retrieve customUserText", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060005",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 0,
        state: "Draft",
        customUserText: "Vielen Dank für Ihren Auftrag.",
      },
    });

    expect(invoice.customUserText).toBe("Vielen Dank für Ihren Auftrag.");
  });
});
