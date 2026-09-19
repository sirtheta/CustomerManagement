import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { matchAndMarkPaid } from "@/lib/payment-matching";

// Finding #14: matchAndMarkPaid was only ever exercised against a mocked
// Prisma client. Run it against a real SQLite database — real Decimal
// totalAmount comparison, the actual state transition, the pendingReminder
// cleanup, and the audit trail it writes.
describe("matchAndMarkPaid against a real database", () => {
  const db = createTestDatabase();

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  it("marks a matching invoice Paid, clears its reminder, and writes an audit log", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-26010001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 123.45,
        state: "Overdue",
      },
    });
    await prisma.pendingReminder.create({
      data: { invoiceId: invoice.id, snoozedUntil: null },
    });

    const result = await matchAndMarkPaid(
      { description: "Zahlung Rechnung R-26010001", amountRappen: 12345 },
      prisma
    );

    expect(result).toEqual({ matched: true, invoiceId: invoice.id, documentNumber: "R-26010001" });

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.state).toBe("Paid");
    expect(updated.paidDate).not.toBeNull();

    const reminders = await prisma.pendingReminder.findMany({ where: { invoiceId: invoice.id } });
    expect(reminders).toHaveLength(0);

    const auditLogs = await prisma.auditLog.findMany({ where: { entityId: invoice.id, entityType: "Invoice" } });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("STATUS");
    expect(JSON.parse(auditLogs[0].details!)).toMatchObject({ from: "Overdue", to: "Paid", source: "budget-import" });
  });

  it("does not match when the real Decimal totalAmount differs by a single Rappen", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-26010002",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100.0,
        state: "Sent",
      },
    });

    const result = await matchAndMarkPaid(
      { description: "Zahlung R-26010002", amountRappen: 10001 },
      prisma
    );

    expect(result).toEqual({ matched: false });
    const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchanged.state).toBe("Sent");
  });

  it("does not re-match an already Paid invoice", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-26010003",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 50,
        state: "Paid",
        paidDate: new Date("2026-01-01"),
      },
    });

    const result = await matchAndMarkPaid(
      { description: "Zahlung R-26010003", amountRappen: 5000 },
      prisma
    );

    expect(result).toEqual({ matched: false });
  });
});
