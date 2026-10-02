import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkSubscriptions } from "@/lib/subscriptions";

describe("checkSubscriptions", () => {
  const db = createTestDatabase();

  const yesterday = new Date(Date.now() - 86_400_000);
  const tomorrow = new Date(Date.now() + 86_400_000);

  async function seedTemplate() {
    return db.prisma.invoiceTemplate.create({
      data: {
        name: "Mitgliederbeitrag",
        items: {
          create: [
            { name: "Beitrag", unit: "Piece", unitPrice: 120, quantity: 1 },
            { name: "Hosting", description: "pro Monat", unit: "Piece", unitPrice: 10.5, quantity: 12 },
          ],
        },
      },
    });
  }

  async function seedSubscription(
    overrides: Partial<{ nextInvoiceDate: Date; interval: "Monthly" | "Quarterly" | "Yearly"; active: boolean; templateId: number | null; archived: boolean; email: string; customer: Partial<Prisma.CustomerUncheckedCreateInput> }> = {}
  ) {
    const customer = await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        email: overrides.email ?? "jane@clientag.ch",
        archivedAt: overrides.archived ? new Date() : null,
        ...overrides.customer,
      },
    });
    return db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: overrides.templateId ?? null,
        interval: overrides.interval ?? "Yearly",
        nextInvoiceDate: overrides.nextInvoiceDate ?? yesterday,
        active: overrides.active ?? true,
      },
    });
  }

  it("creates a draft with template items, the real total and a pending email", async () => {
    const template = await seedTemplate();
    await seedSubscription({ templateId: template.id });
    await checkSubscriptions(db.prisma);

    const invoices = await db.prisma.invoice.findMany({ include: { items: true } });
    const pending = await db.prisma.pendingEmail.findMany();

    expect(invoices).toHaveLength(1);
    expect(invoices[0].state).toBe("Draft");
    expect(invoices[0].documentNumber).toBeNull();
    expect(invoices[0].items).toHaveLength(2);
    expect(invoices[0].totalAmount.toNumber()).toBe(246); // 120 + 12 * 10.5
    expect(pending).toHaveLength(1);
    expect(pending[0].to).toBe("jane@clientag.ch");
    expect(pending[0].subject).toContain("{documentNumber}");
    expect(pending[0].body).toContain("{documentNumber}");
    // Kept as placeholder: resolved at send time from the (possibly edited) invoice total.
    expect(pending[0].body).toContain("{totalAmount}");
    expect(pending[0].body).not.toContain("246");
  });

  it("creates an empty draft when the subscription has no template", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);

    const invoices = await db.prisma.invoice.findMany({ include: { items: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items).toHaveLength(0);
    expect(invoices[0].totalAmount.toNumber()).toBe(0);
  });

  it("sends to the billing e-mail when the customer has one", async () => {
    await seedSubscription({ customer: { billingEmail: "buchhaltung@clientag.ch" } });
    await checkSubscriptions(db.prisma);
    const pending = await db.prisma.pendingEmail.findMany();
    expect(pending).toHaveLength(1);
    expect(pending[0].to).toBe("buchhaltung@clientag.ch");
  });

  it("uses the customer's payment term for the invoice due date", async () => {
    await db.prisma.applicationSettings.create({
      data: { defaultPaymentTermDays: 30, companyInfo: { create: {} } },
    });
    await seedSubscription({ customer: { paymentTermDays: 14 } });
    await checkSubscriptions(db.prisma);
    const [invoice] = await db.prisma.invoice.findMany();
    const days = Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / 86_400_000);
    expect(days).toBe(14);
  });

  it("rounds the draft total to 5 Rappen when the setting is on", async () => {
    await db.prisma.applicationSettings.create({
      data: { roundTotalTo5Rappen: true, companyInfo: { create: {} } },
    });
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "Krumm", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 10.03, quantity: 1 }] } },
    });
    await seedSubscription({ templateId: template.id });
    await checkSubscriptions(db.prisma);

    const [invoice] = await db.prisma.invoice.findMany({ include: { items: true } });
    expect(invoice.totalAmount.toNumber()).toBe(10.05);
    expect(invoice.items[0].totalAmount.toNumber()).toBe(10.03);
  });

  it("keeps the exact draft total when the setting is off", async () => {
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "Krumm", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 10.03, quantity: 1 }] } },
    });
    await seedSubscription({ templateId: template.id });
    await checkSubscriptions(db.prisma);

    const [invoice] = await db.prisma.invoice.findMany();
    expect(invoice.totalAmount.toNumber()).toBe(10.03);
  });

  it("advances nextInvoiceDate by the interval", async () => {
    const sub = await seedSubscription({ interval: "Quarterly", nextInvoiceDate: new Date(2026, 0, 15) });
    await checkSubscriptions(db.prisma);

    const updated = await db.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.nextInvoiceDate.getTime()).toBeGreaterThan(Date.now());
    expect(updated.nextInvoiceDate.getDate()).toBe(15);
  });

  it("creates exactly one invoice after a long downtime", async () => {
    await seedSubscription({ interval: "Monthly", nextInvoiceDate: new Date(2026, 0, 15) });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(1);
  });

  it("skips paused subscriptions", async () => {
    await seedSubscription({ active: false });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("skips subscriptions with a future date", async () => {
    await seedSubscription({ nextInvoiceDate: tomorrow });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("skips archived customers", async () => {
    await seedSubscription({ archived: true });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("handles multiple subscriptions of one customer independently", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    await db.prisma.subscription.createMany({
      data: [
        { customerId: customer.customerId, interval: "Monthly", nextInvoiceDate: yesterday },
        { customerId: customer.customerId, interval: "Yearly", nextInvoiceDate: yesterday },
      ],
    });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(2);
    expect(await db.prisma.pendingEmail.count()).toBe(2);
  });

  it("writes a system audit entry per created invoice", async () => {
    const sub = await seedSubscription();
    await checkSubscriptions(db.prisma);
    const entries = await db.prisma.auditLog.findMany({ where: { entityType: "Invoice", action: "CREATE" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].userName).toBe("System (Abo)");
    expect(entries[0].details).toContain(`"subscriptionId":${sub.id}`);
  });

  it("creates nothing when the subscription was paused after the due list was read", async () => {
    const sub = await seedSubscription();
    // Simulates the window between reading the due list and the transaction.
    const realFindMany = db.prisma.subscription.findMany.bind(db.prisma.subscription);
    const spy = vi.spyOn(db.prisma.subscription, "findMany").mockImplementation(((args: never) =>
      realFindMany(args).then(async (rows: unknown) => {
        await db.prisma.subscription.update({ where: { id: sub.id }, data: { active: false } });
        return rows;
      })) as never);
    await checkSubscriptions(db.prisma);
    spy.mockRestore();
    expect(await db.prisma.invoice.count()).toBe(0);
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("cascade-deletes the pending email when the invoice is deleted", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);
    const invoice = await db.prisma.invoice.findFirstOrThrow();
    await db.prisma.item.deleteMany({ where: { invoiceId: invoice.id } });
    await db.prisma.invoice.delete({ where: { id: invoice.id } });
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });
});
