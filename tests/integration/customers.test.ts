import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("CustomerRepository", () => {
  const db = createTestDatabase();

  // Equivalent: CustomerRepository_AddCustomer_ShouldPersistCustomer
  it("should create and persist a customer", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    expect(customer.customerId).toBeGreaterThan(0);
    expect(customer.contactPerson).toBe("Test Person");
    expect(customer.company).toBe("Client AG");
    expect(customer.email).toBe("jane@clientag.ch");
  });

  // Equivalent: CustomerRepository_GetCustomer_ShouldReturnCorrectCustomer
  it("should retrieve a customer by id", async () => {
    const { prisma } = db;
    const created = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const found = await prisma.customer.findUnique({
      where: { customerId: created.customerId },
    });

    expect(found).not.toBeNull();
    expect(found!.customerId).toBe(created.customerId);
    expect(found!.city).toBe("Zürich");
  });

  it("should return null for a non-existent customer id", async () => {
    const { prisma } = db;
    const found = await prisma.customer.findUnique({
      where: { customerId: 999_999 },
    });
    expect(found).toBeNull();
  });

  // Equivalent: CustomerRepository_UpdateCustomer_ShouldReflectChanges
  it("should update customer fields", async () => {
    const { prisma } = db;
    const created = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const updated = await prisma.customer.update({
      where: { customerId: created.customerId },
      data: { company: "Updated AG", phone: "+41 44 000 00 00" },
    });

    expect(updated.company).toBe("Updated AG");
    expect(updated.phone).toBe("+41 44 000 00 00");
  });

  // Equivalent: CustomerRepository_DeleteCustomer_ShouldRemoveCustomer
  it("should delete a customer", async () => {
    const { prisma } = db;
    const created = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    await prisma.customer.delete({ where: { customerId: created.customerId } });

    const found = await prisma.customer.findUnique({
      where: { customerId: created.customerId },
    });
    expect(found).toBeNull();
  });

  // Equivalent: CustomerRepository_DeleteCustomer_ShouldCascadeToInvoices
  it("should cascade-delete invoices when customer is deleted", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060001",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await prisma.customer.delete({ where: { customerId: customer.customerId } });

    const found = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(found).toBeNull();
  });

  it("should list all customers", async () => {
    const { prisma } = db;
    await prisma.customer.createMany({
      data: [
        createValidTestCustomer(),
        { ...createValidTestCustomer(), email: "other@example.com", company: "Second AG" },
      ],
    });

    const all = await prisma.customer.findMany();
    expect(all).toHaveLength(2);
  });
});
