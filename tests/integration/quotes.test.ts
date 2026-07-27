import { describe, it, expect } from "vitest";
import {
  createTestDatabase,
  createValidTestCustomer,
  createValidItemList,
} from "../test-utils";

describe("QuoteRepository", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  function futureDateMs(days: number) {
    return new Date(Date.now() + days * 86_400_000);
  }

  // Equivalent: BusinessDocumentRepository_AddQuote_ShouldPersist
  it("should create a quote with items", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060001",
        date: new Date(),
        validUntil: futureDateMs(30),
        totalAmount: 250,
        state: "Draft",
        items: { create: createValidItemList() },
      },
      include: { items: true },
    });

    expect(quote.id).toBeGreaterThan(0);
    expect(quote.items).toHaveLength(2);
    expect(Number(quote.totalAmount)).toBe(250);
  });

  // Equivalent: BusinessDocumentRepository_GetQuote_ShouldIncludeCustomerAndItems
  it("should retrieve quote with customer and items", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const created = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060002",
        date: new Date(),
        validUntil: futureDateMs(30),
        totalAmount: 100,
        state: "Draft",
        items: { create: [createValidItemList()[0]] },
      },
    });

    const found = await prisma.quote.findUnique({
      where: { id: created.id },
      include: { customer: true, items: true },
    });

    expect(found).not.toBeNull();
    expect(found!.customer.email).toBe("jane@clientag.ch");
    expect(found!.items).toHaveLength(1);
  });

  // Equivalent: BusinessDocumentRepository_UpdateQuoteState_ShouldPersist
  it("should update quote state from Draft to Sent", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060003",
        date: new Date(),
        validUntil: futureDateMs(30),
        totalAmount: 100,
        state: "Draft",
      },
    });

    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: { state: "Sent" },
    });

    expect(updated.state).toBe("Sent");
  });

  it("should allow all valid quote state values", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const base = {
      customerId: customer.customerId,
      date: new Date(),
      validUntil: futureDateMs(30),
      totalAmount: 0,
    };

    for (const state of ["Draft", "Sent", "Accepted", "Declined", "Expired"] as const) {
      const q = await prisma.quote.create({
        data: { ...base, documentNumber: `Q-${state}`, state },
      });
      expect(q.state).toBe(state);
    }
  });

  it("should cascade-delete quote when customer is deleted", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060004",
        date: new Date(),
        validUntil: futureDateMs(30),
        totalAmount: 0,
        state: "Draft",
      },
    });

    await prisma.customer.delete({ where: { customerId: customer.customerId } });

    const found = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(found).toBeNull();
  });
});
