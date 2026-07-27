import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkOverdueInvoices } from "@/lib/reminders";

describe("checkOverdueInvoices", () => {
  const db = createTestDatabase();

  const pastDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
  const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function seedCustomer() {
    return db.prisma.customer.create({ data: createValidTestCustomer() });
  }

  async function seedOverdueInvoice(customerId: number, num: string) {
    return db.prisma.invoice.create({
      data: {
        customerId,
        documentNumber: num,
        date: pastDate(40),
        dueDate: pastDate(5),
        totalAmount: 500,
        state: "Overdue",
      },
    });
  }

  it("creates a PendingReminder for an overdue invoice with no existing reminder", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const invoice = await seedOverdueInvoice(customer.customerId, "R-240001");

    await checkOverdueInvoices(prisma);

    const reminder = await prisma.pendingReminder.findUnique({ where: { invoiceId: invoice.id } });
    expect(reminder).not.toBeNull();
    expect(reminder!.reminderLevel).toBe(1);
    expect(reminder!.snoozedUntil).toBeNull();
  });

  it("does not create a reminder for a non-overdue (Sent) invoice", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-240002",
        date: pastDate(10),
        dueDate: futureDate(20),
        totalAmount: 200,
        state: "Sent",
      },
    });

    await checkOverdueInvoices(prisma);

    const reminder = await prisma.pendingReminder.findUnique({ where: { invoiceId: invoice.id } });
    expect(reminder).toBeNull();
  });

  it("does not create a second reminder if one already exists (active)", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const invoice = await seedOverdueInvoice(customer.customerId, "R-240003");
    await prisma.pendingReminder.create({ data: { invoiceId: invoice.id } });

    await checkOverdueInvoices(prisma);

    const count = await prisma.pendingReminder.count({ where: { invoiceId: invoice.id } });
    expect(count).toBe(1);
  });

  it("does not create a new reminder if one exists but is snoozed (within cooldown)", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const invoice = await seedOverdueInvoice(customer.customerId, "R-240004");
    // Snoozed until tomorrow — still within cooldown
    await prisma.pendingReminder.create({
      data: { invoiceId: invoice.id, reminderLevel: 2, snoozedUntil: futureDate(1) },
    });

    await checkOverdueInvoices(prisma);

    const count = await prisma.pendingReminder.count({ where: { invoiceId: invoice.id } });
    expect(count).toBe(1); // no duplicate created
  });

  it("handles multiple overdue invoices in one pass", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const inv1 = await seedOverdueInvoice(customer.customerId, "R-240005");
    const inv2 = await seedOverdueInvoice(customer.customerId, "R-240006");
    const inv3 = await seedOverdueInvoice(customer.customerId, "R-240007");

    await checkOverdueInvoices(prisma);

    const count = await prisma.pendingReminder.count({
      where: { invoiceId: { in: [inv1.id, inv2.id, inv3.id] } },
    });
    expect(count).toBe(3);
  });

  it("does nothing when there are no overdue invoices", async () => {
    const { prisma } = db;
    await checkOverdueInvoices(prisma);
    const count = await prisma.pendingReminder.count();
    expect(count).toBe(0);
  });
});

describe("snoozedUntil filter logic", () => {
  const db = createTestDatabase();

  const pastDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
  const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function seedCustomerAndInvoice(num: string) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: num,
        date: pastDate(40),
        dueDate: pastDate(5),
        totalAmount: 500,
        state: "Overdue",
      },
    });
    return invoice;
  }

  it("active reminder (no snooze) is returned in the page query", async () => {
    const { prisma } = db;
    const invoice = await seedCustomerAndInvoice("R-250001");
    await prisma.pendingReminder.create({ data: { invoiceId: invoice.id } });

    const now = new Date();
    const active = await prisma.pendingReminder.findMany({
      where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    });
    expect(active).toHaveLength(1);
  });

  it("snoozed reminder (future snooze) is hidden from the page query", async () => {
    const { prisma } = db;
    const invoice = await seedCustomerAndInvoice("R-250002");
    await prisma.pendingReminder.create({
      data: { invoiceId: invoice.id, snoozedUntil: futureDate(7) },
    });

    const now = new Date();
    const active = await prisma.pendingReminder.findMany({
      where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    });
    expect(active).toHaveLength(0);
  });

  it("expired snooze (past snooze date) is shown again", async () => {
    const { prisma } = db;
    const invoice = await seedCustomerAndInvoice("R-250003");
    await prisma.pendingReminder.create({
      data: { invoiceId: invoice.id, snoozedUntil: pastDate(1) },
    });

    const now = new Date();
    const active = await prisma.pendingReminder.findMany({
      where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    });
    expect(active).toHaveLength(1);
  });

  it("mixed: only active and expired-snooze reminders are returned", async () => {
    const { prisma } = db;
    const active = await seedCustomerAndInvoice("R-250004");
    const snoozed = await seedCustomerAndInvoice("R-250005");
    const expired = await seedCustomerAndInvoice("R-250006");

    await prisma.pendingReminder.create({ data: { invoiceId: active.id } });
    await prisma.pendingReminder.create({ data: { invoiceId: snoozed.id, snoozedUntil: futureDate(3) } });
    await prisma.pendingReminder.create({ data: { invoiceId: expired.id, snoozedUntil: pastDate(2) } });

    const now = new Date();
    const results = await prisma.pendingReminder.findMany({
      where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.invoiceId)).toEqual(
      expect.arrayContaining([active.id, expired.id])
    );
  });
});
