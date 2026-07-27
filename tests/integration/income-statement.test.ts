import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { fetchIncomeStatement, fetchPaidInvoicesForYear } from "@/app/(app)/accounting/lib/income-statement-queries";

describe("fetchIncomeStatement", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  // Regression test for the Ist-Prinzip (cash basis): an invoice issued in
  // December of the previous year but paid in January must count toward the
  // year and month it was *paid*, not the year/month it was issued.
  it("buckets a paid invoice by paidDate, not by issue date", async () => {
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
      },
    });

    const statement2025 = await fetchIncomeStatement(prisma, 2025);
    const statement2026 = await fetchIncomeStatement(prisma, 2026);

    expect(statement2025.totalIncome).toBe(0);
    expect(statement2026.totalIncome).toBe(500);
    expect(statement2026.monthlyResults[0].income).toBe(500); // January
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
      },
    });

    const statement = await fetchIncomeStatement(prisma, new Date().getFullYear());
    expect(statement.availableYears).toContain(2024);
  });
});

describe("fetchPaidInvoicesForYear", () => {
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
      },
    });

    const rows = await fetchPaidInvoicesForYear(prisma, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe("Client AG");
    expect(rows[0].totalAmount).toBe(150);
  });
});
