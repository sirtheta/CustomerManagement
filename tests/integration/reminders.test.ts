import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkOverdueInvoices, isLastReminderLevelSent, latestSentReminders } from "@/lib/reminders";

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

  it("removes a stale reminder whose invoice is no longer Overdue", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const invoice = await seedOverdueInvoice(customer.customerId, "R-240010");
    await prisma.pendingReminder.create({ data: { invoiceId: invoice.id } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { state: "Paid", paidDate: new Date() } });

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

  it("creates no PendingReminder for a credit note", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const original = await seedOverdueInvoice(customer.customerId, "R-240010");
    const credit = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-240011",
        date: pastDate(40),
        dueDate: pastDate(5),
        totalAmount: -100,
        state: "Overdue",
        creditNoteForId: original.id,
      },
    });

    await checkOverdueInvoices(prisma);

    expect(await prisma.pendingReminder.findUnique({ where: { invoiceId: credit.id } })).toBeNull();
    expect(await prisma.pendingReminder.findUnique({ where: { invoiceId: original.id } })).not.toBeNull();
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

describe("isLastReminderLevelSent", () => {
  const db = createTestDatabase();

  async function seed() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId, documentNumber: "I-26090001", date: new Date(),
        dueDate: new Date(Date.now() - 5 * 86_400_000), totalAmount: 500, state: "Overdue",
      },
    });
  }
  function sentLevel4(invoiceId: number, createdAt: Date) {
    return db.prisma.sentDocument.create({
      data: {
        invoiceId, kind: "Reminder", reminderLevel: 4, documentNumber: "I-26090001",
        path: `2026/x-${createdAt.getTime()}.pdf`, sha256: "a".repeat(64), size: 1,
        sentTo: "a@b.ch", subject: "M", createdById: 1, createdAt,
      },
    });
  }

  it("is false below level 4 and true above it", async () => {
    const inv = await seed();
    const r = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 3 } });
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(false);
    expect(await isLastReminderLevelSent(db.prisma, { ...r, reminderLevel: 5 })).toBe(true);
  });

  it("is true once a level-4 notice was sent for this reminder", async () => {
    const inv = await seed();
    const r = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 4 } });
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(false);
    await sentLevel4(inv.id, new Date(r.createdAt.getTime() + 1000));
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(true);
  });

  it("ignores a level-4 notice from before the reminder was recreated", async () => {
    const inv = await seed();
    await sentLevel4(inv.id, new Date(Date.now() - 60_000));
    const fresh = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 4 } });
    expect(await isLastReminderLevelSent(db.prisma, fresh)).toBe(false);
  });
});

describe("latestSentReminders", () => {
  const db = createTestDatabase();

  async function seed(num: string) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId, documentNumber: num, date: new Date(),
        dueDate: new Date(Date.now() - 5 * 86_400_000), totalAmount: 500, state: "Overdue",
      },
    });
  }
  function sent(invoiceId: number, kind: string, reminderLevel: number | null, createdAt: Date) {
    return db.prisma.sentDocument.create({
      data: {
        invoiceId, kind, reminderLevel, documentNumber: "I-1",
        path: `2026/${invoiceId}-${kind}-${createdAt.getTime()}.pdf`, sha256: "a".repeat(64), size: 1,
        sentTo: "a@b.ch", subject: "M", createdById: 1, createdAt,
      },
    });
  }

  it("returns the newest reminder notice per invoice, ignoring invoice mails", async () => {
    const a = await seed("I-26100001");
    const b = await seed("I-26100002");
    const ra = await db.prisma.pendingReminder.create({ data: { invoiceId: a.id, reminderLevel: 3 } });
    const rb = await db.prisma.pendingReminder.create({ data: { invoiceId: b.id, reminderLevel: 1 } });
    const t = ra.createdAt.getTime();
    await sent(a.id, "Reminder", 1, new Date(t + 1000));
    await sent(a.id, "Reminder", 2, new Date(t + 2000));
    await sent(a.id, "Invoice", null, new Date(t + 3000));

    const result = await latestSentReminders(db.prisma, [ra, rb]);
    expect(result.get(a.id)).toEqual({ level: 2, sentAt: new Date(t + 2000) });
    expect(result.has(b.id)).toBe(false);
  });

  it("skips notices from before the reminder was recreated", async () => {
    const inv = await seed("I-26100003");
    await sent(inv.id, "Reminder", 4, new Date(Date.now() - 60_000));
    const fresh = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id } });
    expect((await latestSentReminders(db.prisma, [fresh])).size).toBe(0);
  });

  it("does not query without reminders", async () => {
    expect((await latestSentReminders(db.prisma, [])).size).toBe(0);
  });
});
