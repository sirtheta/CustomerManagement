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

  it("respects credit note dates against the cut-off", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });
    const original = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-2",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Canceled",
      },
    });
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "G-1",
        date: new Date("2026-03-01"),
        dueDate: new Date("2026-03-01"),
        totalAmount: -100,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });

    const after = await fetchReceivables(prisma, new Date("2026-12-31"));
    expect(after.rows).toEqual([]);

    const before = await fetchReceivables(prisma, new Date("2026-02-15"));
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({ documentNumber: "R-2", openRappen: 10000 });
  });

  it("carries the billing address of the customer into the report", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        billingStreet: "Postfach",
        billingHouseNumber: "7",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
      },
    });
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-9",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Sent",
      },
    });

    const report = await fetchReceivables(prisma, new Date("2026-12-31"));
    expect(report.rows[0].customerAddress).toEqual({
      street: "Postfach 7",
      zip: "3000",
      city: "Bern",
      country: "CH",
    });
  });
});
