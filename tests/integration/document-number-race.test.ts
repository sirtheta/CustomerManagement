import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { generateInvoiceNumber, generateQuoteNumber } from "@/lib/document-number";

// Finding #1/#14: the documentNumber race and its unique-constraint fix were
// only ever verified against a mocked Prisma client. These run the actual
// unique constraint (and generateInvoiceNumber/generateQuoteNumber's
// max-sequence read) against a real SQLite database.
describe("document number uniqueness against a real database", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  it("rejects a second invoice with a duplicate documentNumber at the DB level", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-26010001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await expect(
      prisma.invoice.create({
        data: {
          customerId: customer.customerId,
          documentNumber: "I-26010001",
          date: new Date(),
          dueDate: new Date(),
          totalAmount: 200,
          state: "Draft",
        },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("rejects a second quote with a duplicate documentNumber at the DB level", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "O-26010001",
        date: new Date(),
        validUntil: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await expect(
      prisma.quote.create({
        data: {
          customerId: customer.customerId,
          documentNumber: "O-26010001",
          date: new Date(),
          validUntil: new Date(),
          totalAmount: 200,
          state: "Draft",
        },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("generateInvoiceNumber continues the real max sequence for the month", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const first = await generateInvoiceNumber(prisma);
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: first,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });

    const second = await generateInvoiceNumber(prisma);
    expect(second).not.toBe(first);

    const firstSeq = parseInt(first.slice(-4), 10);
    const secondSeq = parseInt(second.slice(-4), 10);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it("a colliding number computed before the first commit is caught by the unique constraint", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    // Simulates two concurrent requests that both read the same max sequence
    // before either has committed — generateQuoteNumber has no lock of its
    // own, so this collision is exactly what the @@unique constraint (and the
    // createInvoice/createQuote retry-on-P2002 logic) must catch.
    const numberA = await generateQuoteNumber(prisma);
    const numberB = await generateQuoteNumber(prisma); // same read, no commit yet

    expect(numberB).toBe(numberA);

    await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: numberA,
        date: new Date(),
        validUntil: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await expect(
      prisma.quote.create({
        data: {
          customerId: customer.customerId,
          documentNumber: numberB,
          date: new Date(),
          validUntil: new Date(),
          totalAmount: 100,
          state: "Draft",
        },
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
