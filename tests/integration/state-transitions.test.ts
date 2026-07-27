import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkAndUpdateDocumentStates } from "@/lib/state-manager";

describe("DocumentStateManager", () => {
  const db = createTestDatabase();

  const pastDate = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000);
  const futureDate = (days: number) =>
    new Date(Date.now() + days * 86_400_000);

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  // Equivalent: CheckAndUpdateDocumentStates_WithOverdueInvoice_ShouldUpdateState
  it("should mark Sent invoices as Overdue when past due date", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const overdue = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2024001",
        date: pastDate(40),
        dueDate: pastDate(10),
        totalAmount: 100,
        state: "Sent",
      },
    });

    const current = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2024002",
        date: new Date(),
        dueDate: futureDate(30),
        totalAmount: 100,
        state: "Sent",
      },
    });

    await checkAndUpdateDocumentStates(prisma, [overdue.id, current.id], []);

    const updatedOverdue = await prisma.invoice.findUnique({ where: { id: overdue.id } });
    const updatedCurrent = await prisma.invoice.findUnique({ where: { id: current.id } });

    expect(updatedOverdue!.state).toBe("Overdue");
    expect(updatedCurrent!.state).toBe("Sent"); // not affected
  });

  // Equivalent: CheckAndUpdateDocumentStates_WithNonSentDocuments_ShouldNotUpdateState
  it("should not change Draft invoices even when past due date", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const draft = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2024003",
        date: pastDate(40),
        dueDate: pastDate(10),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await checkAndUpdateDocumentStates(prisma, [draft.id], []);

    const unchanged = await prisma.invoice.findUnique({ where: { id: draft.id } });
    expect(unchanged!.state).toBe("Draft");
  });

  it("should not change Paid invoices even when past due date", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const paid = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-2024004",
        date: pastDate(40),
        dueDate: pastDate(10),
        totalAmount: 100,
        state: "Paid",
      },
    });

    await checkAndUpdateDocumentStates(prisma, [paid.id], []);

    const unchanged = await prisma.invoice.findUnique({ where: { id: paid.id } });
    expect(unchanged!.state).toBe("Paid");
  });

  // Equivalent: CheckAndUpdateDocumentStates_WithExpiredQuote_ShouldUpdateState
  it("should mark Sent quotes as Expired when past validUntil", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();

    const expired = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-2024001",
        date: pastDate(40),
        validUntil: pastDate(5),
        totalAmount: 100,
        state: "Sent",
      },
    });

    const valid = await prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-2024002",
        date: new Date(),
        validUntil: futureDate(30),
        totalAmount: 100,
        state: "Sent",
      },
    });

    await checkAndUpdateDocumentStates(prisma, [], [expired.id, valid.id]);

    const updatedExpired = await prisma.quote.findUnique({ where: { id: expired.id } });
    const updatedValid = await prisma.quote.findUnique({ where: { id: valid.id } });

    expect(updatedExpired!.state).toBe("Expired");
    expect(updatedValid!.state).toBe("Sent");
  });

  it("should handle empty id arrays without errors", async () => {
    const { prisma } = db;
    await expect(
      checkAndUpdateDocumentStates(prisma, [], [])
    ).resolves.toBeUndefined();
  });
});
