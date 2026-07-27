import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkYearlyInvoices } from "@/lib/yearly-invoices";

describe("checkYearlyInvoices", () => {
  const db = createTestDatabase();

  const yesterday = new Date(Date.now() - 86_400_000);
  const tomorrow = new Date(Date.now() + 86_400_000);

  async function seedDueCustomer() {
    return db.prisma.customer.create({
      data: { ...createValidTestCustomer(), yearlyInvoice: true, nextInvoiceDate: yesterday },
    });
  }

  it("creates an invoice and pending email for a due customer", async () => {
    await seedDueCustomer();
    await checkYearlyInvoices(db.prisma);

    const invoices = await db.prisma.invoice.findMany();
    const pending = await db.prisma.pendingEmail.findMany();

    expect(invoices).toHaveLength(1);
    expect(invoices[0].state).toBe("Draft");
    expect(invoices[0].totalAmount.toNumber()).toBe(0);
    expect(pending).toHaveLength(1);
    expect(pending[0].to).toBe("jane@clientag.ch");
  });

  it("advances nextInvoiceDate by one year", async () => {
    const customer = await seedDueCustomer();
    await checkYearlyInvoices(db.prisma);

    const updated = await db.prisma.customer.findUnique({
      where: { customerId: customer.customerId },
    });

    expect(updated!.nextInvoiceDate!.getFullYear()).toBe(yesterday.getFullYear() + 1);
  });

  it("skips customer with yearlyInvoice=false", async () => {
    await db.prisma.customer.create({
      data: { ...createValidTestCustomer(), yearlyInvoice: false, nextInvoiceDate: yesterday },
    });
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(0);
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("skips customer with future nextInvoiceDate", async () => {
    await db.prisma.customer.create({
      data: { ...createValidTestCustomer(), yearlyInvoice: true, nextInvoiceDate: tomorrow },
    });
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("skips customer with null nextInvoiceDate", async () => {
    await db.prisma.customer.create({
      data: { ...createValidTestCustomer(), yearlyInvoice: true, nextInvoiceDate: null },
    });
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("is idempotent – does not create duplicates on second call", async () => {
    await seedDueCustomer();
    await checkYearlyInvoices(db.prisma);
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("cascade-deletes pending email when invoice is deleted", async () => {
    await seedDueCustomer();
    await checkYearlyInvoices(db.prisma);

    const invoice = await db.prisma.invoice.findFirst();
    await db.prisma.item.deleteMany({ where: { invoiceId: invoice!.id } });
    await db.prisma.invoice.delete({ where: { id: invoice!.id } });

    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("handles multiple due customers independently", async () => {
    await db.prisma.customer.createMany({
      data: [
        { ...createValidTestCustomer(), email: "a@test.ch", yearlyInvoice: true, nextInvoiceDate: yesterday },
        { ...createValidTestCustomer(), email: "b@test.ch", yearlyInvoice: true, nextInvoiceDate: yesterday },
        { ...createValidTestCustomer(), email: "c@test.ch", yearlyInvoice: false, nextInvoiceDate: yesterday },
      ],
    });
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(2);
    expect(await db.prisma.pendingEmail.count()).toBe(2);
  });
});
