import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { fetchReceivables } from "@/lib/receivables";

describe("fetchReceivables against a real database", () => {
  const db = createTestDatabase();

  it("returns the remaining amount as of the cut-off date", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-1",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Paid",
        paidDate: new Date("2027-02-01"),
        payments: {
          create: [
            { date: new Date("2026-06-01"), amount: 30 },
            { date: new Date("2027-02-01"), amount: 70 },
          ],
        },
      },
    });

    const report = await fetchReceivables(prisma, new Date("2026-12-31"));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ documentNumber: "R-1", openRappen: 7000, bucket: "d90plus" });

    const later = await fetchReceivables(prisma, new Date("2027-03-01"));
    expect(later.rows).toEqual([]);
  });
});
