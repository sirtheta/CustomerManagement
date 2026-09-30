import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { fetchIncomeStatement, fetchPaymentsForYear } from "@/app/(app)/accounting/lib/income-statement-queries";

describe("fetchIncomeStatement", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  // Regression test for the Ist-Prinzip (cash basis): an invoice issued in
  // December of the previous year but paid in January must count toward the
  // year and month it was *paid*, not the year/month it was issued.
  it("buckets a paid invoice by payment date, not by issue date", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2025120001",
        date: new Date(2025, 11, 20), // issued Dec 2025
        dueDate: new Date(2026, 0, 19),
        totalAmount: 500,
        state: "Paid",
        paidDate: new Date(2026, 0, 5), // paid Jan 2026
        payments: { create: [{ date: new Date(2026, 0, 5), amount: 500 }] },
      },
    });

    const statement2025 = await fetchIncomeStatement(prisma, 2025);
    const statement2026 = await fetchIncomeStatement(prisma, 2026);

    expect(statement2025.totalIncome).toBe(0);
    expect(statement2026.totalIncome).toBe(500);
    expect(statement2026.monthlyResults[0].income).toBe(500); // January
  });

  it("books a partial payment and the rest in their own months", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-1",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Paid",
        paidDate: new Date("2026-05-02T12:00:00Z"),
        payments: {
          create: [
            { date: new Date("2026-03-05T12:00:00Z"), amount: 40 },
            { date: new Date("2026-05-02T12:00:00Z"), amount: 60 },
          ],
        },
      },
    });

    const result = await fetchIncomeStatement(prisma, 2026);
    expect(result.monthlyResults[2].income).toBe(40); // März
    expect(result.monthlyResults[4].income).toBe(60); // Mai
    expect(result.totalIncome).toBe(100);
  });

  it("counts the payment of a PartiallyPaid invoice as income", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-2",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "PartiallyPaid",
        payments: { create: [{ date: new Date("2026-04-01T12:00:00Z"), amount: 25 }] },
      },
    });
    expect((await fetchIncomeStatement(prisma, 2026)).totalIncome).toBe(25);
  });

  it("does not count paidDate without a payment row", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-3",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Paid",
        paidDate: new Date("2026-04-01T12:00:00Z"),
      },
    });
    expect((await fetchIncomeStatement(prisma, 2026)).totalIncome).toBe(0);
  });

  it("excludes unpaid invoices from income", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2026010001",
        date: new Date(2026, 0, 10),
        dueDate: new Date(2026, 1, 9),
        totalAmount: 300,
        state: "Sent",
      },
    });

    const statement = await fetchIncomeStatement(prisma, 2026);
    expect(statement.totalIncome).toBe(0);
  });

  it("buckets expenses by their own date and computes net result", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2026020001",
        date: new Date(2026, 1, 1),
        dueDate: new Date(2026, 2, 1),
        totalAmount: 1000,
        state: "Paid",
        paidDate: new Date(2026, 1, 15),
        payments: { create: [{ date: new Date(2026, 1, 15), amount: 1000 }] },
      },
    });

    await prisma.expense.create({
      data: {
        date: new Date(2026, 1, 20),
        description: "Material",
        amount: 200,
      },
    });

    const statement = await fetchIncomeStatement(prisma, 2026);

    expect(statement.totalIncome).toBe(1000);
    expect(statement.totalExpenses).toBe(200);
    expect(statement.netResult).toBe(800);
    expect(statement.monthlyResults[1].net).toBe(800); // February
  });

  it("includes the years of paid invoices and expenses in availableYears", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2024010001",
        date: new Date(2024, 0, 1),
        dueDate: new Date(2024, 1, 1),
        totalAmount: 100,
        state: "Paid",
        paidDate: new Date(2024, 0, 15),
        payments: { create: [{ date: new Date(2024, 0, 15), amount: 100 }] },
      },
    });

    const statement = await fetchIncomeStatement(prisma, new Date().getFullYear());
    expect(statement.availableYears).toContain(2024);
  });
});

describe("fetchPaymentsForYear", () => {
  const db = createTestDatabase();

  it("resolves customer display name and orders by paidDate desc", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2026030001",
        date: new Date(2026, 2, 1),
        dueDate: new Date(2026, 3, 1),
        totalAmount: 150,
        state: "Paid",
        paidDate: new Date(2026, 2, 10),
        payments: { create: [{ date: new Date(2026, 2, 10), amount: 150 }] },
      },
    });

    const rows = await fetchPaymentsForYear(prisma, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe("Client AG");
    expect(rows[0].amount).toBe(150);
    expect(rows[0].invoiceId).toBeGreaterThan(0);
    expect(rows[0].id).toBeGreaterThan(0);
  });
});
