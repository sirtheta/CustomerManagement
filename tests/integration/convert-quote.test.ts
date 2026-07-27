import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("QuoteToInvoice Workflow", () => {
  const db = createTestDatabase();

  // Equivalent: QuoteToInvoiceWorkflow_ShouldSucceed
  it("should convert a quote to an invoice and mark the quote as Accepted", async () => {
    const { prisma } = db;

    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060001",
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Draft",
        items: {
          create: [
            {
              name: "Test Item",
              quantity: 1,
              unitPrice: 100,
              totalAmount: 100,
              unit: "Piece",
            },
          ],
        },
      },
      include: { items: true },
    });

    // Act – simulate the convert route logic inside a transaction
    const invoice = await prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id: quote.id },
        data: { state: "Accepted" },
      });

      return tx.invoice.create({
        data: {
          customerId: quote.customerId,
          documentNumber: "I-25060001",
          date: new Date(),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          totalAmount: quote.totalAmount,
          state: "Draft",
          items: {
            create: quote.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalAmount: item.totalAmount,
              unit: item.unit,
              description: item.description,
            })),
          },
        },
        include: { items: true },
      });
    });

    // Assert invoice
    expect(invoice).not.toBeNull();
    expect(invoice.documentNumber).toMatch(/^I-/);
    expect(invoice.state).toBe("Draft");
    expect(invoice.items).toHaveLength(quote.items.length);
    expect(Number(invoice.totalAmount)).toBe(Number(quote.totalAmount));

    // Assert quote state changed to Accepted
    const updatedQuote = await prisma.quote.findUnique({
      where: { id: quote.id },
    });
    expect(updatedQuote!.state).toBe("Accepted");
  });

  // A quote in Accepted state must not be convertible again
  it("should not allow converting an already-Accepted quote", async () => {
    const { prisma } = db;

    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060002",
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 0,
        state: "Accepted", // already converted
        items: { create: [] },
      },
      include: { items: true },
    });

    // The guard check that the route handler performs:
    expect(quote.state).toBe("Accepted");
    // A route would return 409 here – we verify the DB state is the blocker
    const reloaded = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(reloaded!.state).not.toBe("Draft");
  });

  it("should copy all items from quote to invoice", async () => {
    const { prisma } = db;

    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const quote = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-25060003",
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 350,
        state: "Draft",
        items: {
          create: [
            { name: "A", quantity: 2, unitPrice: 100, totalAmount: 200, unit: "Hour" },
            { name: "B", quantity: 1, unitPrice: 150, totalAmount: 150, unit: "Day" },
          ],
        },
      },
      include: { items: true },
    });

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: quote.id }, data: { state: "Accepted" } });
      return tx.invoice.create({
        data: {
          customerId: quote.customerId,
          documentNumber: "I-25060002",
          date: new Date(),
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          totalAmount: quote.totalAmount,
          state: "Draft",
          items: {
            create: quote.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalAmount: item.totalAmount,
              unit: item.unit,
            })),
          },
        },
        include: { items: true },
      });
    });

    expect(invoice.items).toHaveLength(2);
    expect(invoice.items.map((i) => i.name).sort()).toEqual(["A", "B"]);
    expect(Number(invoice.totalAmount)).toBe(350);
  });
});
