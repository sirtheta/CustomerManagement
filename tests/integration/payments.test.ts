import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import {
  recordPayment,
  recordRemainingPayment,
  deletePayment,
  getPaymentSummary,
  sumOpenAmount,
  syncInvoiceState,
  PaymentError,
} from "@/lib/payments";

const actor = { user: { id: "1", name: "Tester", email: "t@example.ch" } } as Session;

describe("payments against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(total = 100, state: "Sent" | "Overdue" | "Draft" = "Sent") {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
      },
    });
  }

  it("partial payment sets PartiallyPaid, rest sets Paid with last payment date", async () => {
    const inv = await seedInvoice(100);
    const first = await recordPayment(
      { invoiceId: inv.id, amount: 40, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    expect(first.state).toBe("PartiallyPaid");
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();

    const second = await recordPayment(
      { invoiceId: inv.id, amount: 60, date: new Date("2026-05-02"), source: "manual", actor },
      db.prisma
    );
    expect(second.state).toBe("Paid");
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-05-02");
  });

  it("accepts an overpayment and reports it in the summary", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 105.5, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    const row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("Paid");
    expect(await getPaymentSummary(inv.id, db.prisma)).toEqual({
      totalRappen: 10000,
      paidRappen: 10550,
      creditedRappen: 0,
      remainingRappen: 0,
      overpaidRappen: 550,
    });
  });

  it("rejects payments on drafts and non-positive amounts", async () => {
    const draft = await seedInvoice(100, "Draft");
    await expect(
      recordPayment({ invoiceId: draft.id, amount: 10, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
    const inv = await seedInvoice(100);
    await expect(
      recordPayment({ invoiceId: inv.id, amount: 0, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
  });

  it("recordRemainingPayment pays the rest once and returns null afterwards", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 30, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    const res = await recordRemainingPayment(
      { invoiceId: inv.id, date: new Date("2026-02-02"), source: "manual", actor },
      db.prisma
    );
    expect(res?.state).toBe("Paid");
    const payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments.map((p) => p.amount.toNumber()).sort()).toEqual([30, 70]);
    expect(
      await recordRemainingPayment(
        { invoiceId: inv.id, date: new Date(), source: "manual", actor },
        db.prisma
      )
    ).toBeNull();
  });

  it("deleting payments walks the state back and clears paidDate", async () => {
    const inv = await seedInvoice(100);
    const { paymentId } = await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    const { state } = await deletePayment({ paymentId, actor }, db.prisma);
    expect(state).toBe("Sent");
    const row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();
  });

  it("concurrent recordRemainingPayment calls book the remainder only once", async () => {
    const inv = await seedInvoice(100);
    const params = { invoiceId: inv.id, date: new Date("2026-02-01"), source: "manual" as const, actor };
    const results = await Promise.all([
      recordRemainingPayment(params, db.prisma),
      recordRemainingPayment(params, db.prisma),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it("syncInvoiceState follows a changed invoice total", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    await db.prisma.invoice.update({ where: { id: inv.id }, data: { totalAmount: 150 } });
    expect((await syncInvoiceState({ invoiceId: inv.id, actor, source: "edit" }, db.prisma)).state).toBe(
      "PartiallyPaid"
    );
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();

    await db.prisma.invoice.update({ where: { id: inv.id }, data: { totalAmount: 80 } });
    expect((await syncInvoiceState({ invoiceId: inv.id, actor, source: "edit" }, db.prisma)).state).toBe("Paid");
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("deletes the pending reminder when the invoice becomes Paid", async () => {
    const inv = await seedInvoice(100, "Overdue");
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id } });
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date(), source: "manual", actor },
      db.prisma
    );
    expect(await db.prisma.pendingReminder.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it("writes payment and status audit entries", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date(), source: "camt-import", bankReference: "REF1", actor },
      db.prisma
    );
    const logs = await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(logs.map((l) => `${l.action}:${l.entityType}`)).toEqual(["CREATE:Payment", "STATUS:Invoice"]);
    expect(JSON.parse(logs[1].details!)).toMatchObject({ from: "Sent", to: "Paid", source: "camt-import" });
  });

  it("sumOpenAmount subtracts payments and includes PartiallyPaid", async () => {
    const a = await seedInvoice(100);
    await seedInvoice(50);
    await recordPayment(
      { invoiceId: a.id, amount: 40, date: new Date(), source: "manual", actor },
      db.prisma
    );
    expect(await sumOpenAmount(db.prisma)).toEqual({ amount: 110, count: 2 });
  });

  async function seedCreditNote(originalId: number, customerId: number, total: number, state: "Draft" | "Sent" = "Sent") {
    return db.prisma.invoice.create({
      data: {
        customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-02-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: -total,
        state,
        creditNoteForId: originalId,
      },
    });
  }

  it("summary subtracts sent credit notes and ignores draft ones", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    await seedCreditNote(inv.id, inv.customerId, 50, "Draft");
    expect(await getPaymentSummary(inv.id, db.prisma)).toEqual({
      totalRappen: 10000,
      paidRappen: 0,
      creditedRappen: 3000,
      remainingRappen: 7000,
      overpaidRappen: 0,
    });
  });

  it("syncInvoiceState turns a fully credited unpaid invoice into Canceled", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 100);
    const res = await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    expect(res.state).toBe("Canceled");
  });

  it("a partial credit then a payment of the rest marks the invoice Paid", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    const paid = await recordRemainingPayment(
      { invoiceId: inv.id, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    expect(paid?.state).toBe("Paid");
    const row = await db.prisma.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(row.amount.toNumber()).toBe(70);
  });

  it("reports the overpayment of a paid invoice that is credited afterwards", async () => {
    const inv = await seedInvoice(100);
    await recordPayment({ invoiceId: inv.id, amount: 100, date: new Date("2026-03-01"), source: "manual", actor }, db.prisma);
    await seedCreditNote(inv.id, inv.customerId, 100);
    await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    const summary = await getPaymentSummary(inv.id, db.prisma);
    expect(summary.overpaidRappen).toBe(10000);
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).state).toBe("Paid");
  });

  it("rejects payments on a credit note", async () => {
    const inv = await seedInvoice(100);
    const credit = await seedCreditNote(inv.id, inv.customerId, 20);
    await expect(
      recordPayment({ invoiceId: credit.id, amount: 5, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
  });

  it("sumOpenAmount counts the remainder after credit notes and skips credit notes themselves", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    expect(await sumOpenAmount(db.prisma)).toEqual({ amount: 70, count: 1 });
  });
});
