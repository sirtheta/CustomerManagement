import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { searchGlobal, SEARCH_MAX_RESULTS } from "@/lib/search";

describe("searchGlobal", () => {
  const db = createTestDatabase();

  async function seedCustomer(overrides: Partial<ReturnType<typeof createValidTestCustomer>> = {}) {
    return db.prisma.customer.create({
      data: { ...createValidTestCustomer(), ...overrides },
    });
  }

  function invoiceData(customerId: number, documentNumber: string, date = new Date()) {
    return {
      customerId,
      documentNumber,
      date,
      dueDate: new Date(date.getTime() + 30 * 86_400_000),
      totalAmount: 150,
      state: "Draft" as const,
    };
  }

  function quoteData(customerId: number, documentNumber: string, date = new Date()) {
    return {
      customerId,
      documentNumber,
      date,
      validUntil: new Date(date.getTime() + 30 * 86_400_000),
      totalAmount: 99.5,
      state: "Draft" as const,
    };
  }

  it("should find customers by company, contactPerson, email and city", async () => {
    const { prisma } = db;
    await seedCustomer({
      company: "Bergbahn AG",
      contactPerson: "Anna Muster",
      email: "anna@bergbahn.ch",
      city: "Chur",
    });

    for (const term of ["Bergbahn", "Anna Mus", "anna@bergbahn", "Chur"]) {
      const res = await searchGlobal(prisma, term);
      expect(res.customers, `term: ${term}`).toHaveLength(1);
      expect(res.customers[0].company).toBe("Bergbahn AG");
    }
  });

  it("should find invoices and quotes by document number and customer fields", async () => {
    const { prisma } = db;
    const customer = await seedCustomer({ company: "Seeblick GmbH", contactPerson: "Beat Keller" });
    await prisma.invoice.create({ data: invoiceData(customer.customerId, "I-25060001") });
    await prisma.quote.create({ data: quoteData(customer.customerId, "Q-25060001") });

    for (const term of ["I-2506", "Seeblick", "Beat"]) {
      const res = await searchGlobal(prisma, term);
      expect(res.invoices, `term: ${term}`).toHaveLength(1);
      expect(res.invoices[0].documentNumber).toBe("I-25060001");
    }
    for (const term of ["Q-2506", "Seeblick", "Beat"]) {
      const res = await searchGlobal(prisma, term);
      expect(res.quotes, `term: ${term}`).toHaveLength(1);
      expect(res.quotes[0].documentNumber).toBe("Q-25060001");
    }
  });

  it("should limit each result group to the maximum", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    for (let i = 0; i < SEARCH_MAX_RESULTS + 1; i++) {
      await prisma.invoice.create({
        data: invoiceData(customer.customerId, `I-2506000${i}`),
      });
    }

    const res = await searchGlobal(prisma, "I-2506");
    expect(res.invoices).toHaveLength(SEARCH_MAX_RESULTS);
  });

  it("should order customers by contactPerson asc and documents by date desc", async () => {
    const { prisma } = db;
    const c1 = await seedCustomer({ contactPerson: "Zoe Wirth", company: "Alpha AG", email: "zoe@alpha.ch" });
    await seedCustomer({ contactPerson: "Aldo Brun", company: "Alpha GmbH", email: "aldo@alpha.ch" });
    await prisma.invoice.create({
      data: invoiceData(c1.customerId, "I-25060001", new Date("2025-01-01")),
    });
    await prisma.invoice.create({
      data: invoiceData(c1.customerId, "I-25060002", new Date("2025-03-01")),
    });

    const res = await searchGlobal(prisma, "Alpha");
    expect(res.customers.map((c) => c.contactPerson)).toEqual(["Aldo Brun", "Zoe Wirth"]);
    expect(res.invoices.map((i) => i.documentNumber)).toEqual(["I-25060002", "I-25060001"]);
  });

  it("should return serializable DTOs (number amount, ISO string date)", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    await prisma.invoice.create({ data: invoiceData(customer.customerId, "I-25060001") });
    await prisma.quote.create({ data: quoteData(customer.customerId, "Q-25060001") });

    const res = await searchGlobal(prisma, "Client AG");
    expect(typeof res.invoices[0].totalAmount).toBe("number");
    expect(res.invoices[0].totalAmount).toBe(150);
    expect(typeof res.invoices[0].date).toBe("string");
    expect(new Date(res.invoices[0].date).getTime()).not.toBeNaN();
    expect(typeof res.quotes[0].totalAmount).toBe("number");
    expect(res.quotes[0].totalAmount).toBe(99.5);
  });

  it("should resolve customerName according to contactInsteadOfCompany", async () => {
    const { prisma } = db;
    const c1 = await seedCustomer({
      company: "Muster AG",
      contactPerson: "Hans Muster",
      contactInsteadOfCompany: false,
    });
    const c2 = await seedCustomer({
      company: "Beispiel AG",
      contactPerson: "Petra Beispiel",
      contactInsteadOfCompany: true,
      email: "petra@beispiel.ch",
    });
    await prisma.invoice.create({ data: invoiceData(c1.customerId, "I-25060001") });
    await prisma.invoice.create({ data: invoiceData(c2.customerId, "I-25060002") });

    const res = await searchGlobal(prisma, "I-2506");
    const byNumber = Object.fromEntries(res.invoices.map((i) => [i.documentNumber, i.customerName]));
    expect(byNumber["I-25060001"]).toBe("Muster AG");
    expect(byNumber["I-25060002"]).toBe("Petra Beispiel");
  });

  it("should return empty results for empty or whitespace terms", async () => {
    const { prisma } = db;
    await seedCustomer();

    for (const term of ["", "   "]) {
      const res = await searchGlobal(prisma, term);
      expect(res.customers).toHaveLength(0);
      expect(res.invoices).toHaveLength(0);
      expect(res.quotes).toHaveLength(0);
    }
  });
});
