import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("SentDocument", () => {
  const db = createTestDatabase();

  async function seed() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-26090001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Sent",
      },
    });
    const sent = await db.prisma.sentDocument.create({
      data: {
        invoiceId: invoice.id,
        kind: "Invoice",
        documentNumber: "I-26090001",
        path: "2026/I-26090001_Invoice_20260930T101500000Z.pdf",
        sha256: "a".repeat(64),
        size: 123,
        sentTo: "kunde@test.ch",
        subject: "Rechnung",
        createdById: 1,
      },
    });
    return { customer, invoice, sent };
  }

  it("stores a sent document for an invoice", async () => {
    const { invoice, sent } = await seed();
    const found = await db.prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { sentDocuments: true },
    });
    expect(found!.sentDocuments.map((d) => d.id)).toEqual([sent.id]);
  });

  it("blocks deleting an invoice that has a sent document", async () => {
    const { invoice } = await seed();
    await expect(db.prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow();
    expect(await db.prisma.invoice.count({ where: { id: invoice.id } })).toBe(1);
  });

  it("blocks deleting a customer whose invoice has a sent document (no cascade around Restrict)", async () => {
    const { customer, invoice } = await seed();
    await expect(
      db.prisma.customer.delete({ where: { customerId: customer.customerId } })
    ).rejects.toThrow();
    expect(await db.prisma.invoice.count({ where: { id: invoice.id } })).toBe(1);
  });
});
