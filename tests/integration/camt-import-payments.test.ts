import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The actions use the default prisma singleton (also inside lib/payments).
// Route it to the per-suite test database via a proxy.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    { get: (_t, prop) => (holder.prisma as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => ({
    user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" },
  })),
  requireAdmin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  bookExpenses,
  bookPayments,
  ignoreTransactions,
  undoStatementImport,
} from "@/app/(app)/invoices/import/actions";
import { importStatement } from "@/lib/import/bank-import";
import type { ParsedTransaction } from "@/lib/import/types";
import type { Session } from "next-auth";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;

describe("CAMT import actions against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(state: "Sent" | "Paid" | "Draft" = "Sent", total = 100) {
    holder.prisma = db.prisma;
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
        paidDate: state === "Paid" ? new Date("2026-02-01") : null,
      },
    });
  }

  /** Stores the given entries through the real import and returns their ids in order. */
  async function seedTransactions(entries: Array<Partial<ParsedTransaction>>) {
    holder.prisma = db.prisma;
    const result = await importStatement(
      {
        statement: {
          transactions: entries.map((e, i) => ({
            date: "2026-03-01",
            amountCents: 4000,
            description: "Zahlung",
            counterparty: null,
            bankReference: `REF-${i}-${Math.random()}`,
            ...e,
          })),
          iban: "CH9300762011623852957",
          currency: "CHF",
          openingBalanceCents: null,
          closingBalanceCents: null,
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          warnings: [],
        },
        filename: "t.xml",
        actor,
      },
      db.prisma
    );
    const rows = await db.prisma.bankTransaction.findMany({
      where: { importId: result.importId! },
      orderBy: { id: "asc" },
    });
    return { importId: result.importId!, ids: rows.map((r) => r.id) };
  }

  it("books a partial payment, ignores a duplicate confirmation, and completes with the rest", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([
      { amountCents: 4000, bankReference: "REF-A", date: "2026-03-01" },
      { amountCents: 6000, bankReference: "REF-B", date: "2026-03-15" },
    ]);

    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 1 });
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("PartiallyPaid");
    const payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toNumber()).toBe(40);
    expect(payments[0].source).toBe("camt-import");
    expect(payments[0].bankReference).toBe("REF-A");
    const linked = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(linked.paymentId).toBe(payments[0].id);

    // Same entry confirmed again (second tab): no second payment.
    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);

    expect(await bookPayments([{ transactionId: ids[1], invoiceId: inv.id }])).toEqual({ paidCount: 1 });
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("Paid");
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("does not book an entry whose bank reference already paid another invoice", async () => {
    const first = await seedInvoice();
    const second = await seedInvoice();
    const a = await seedTransactions([{ bankReference: "REF-SHARED", date: "2026-03-01" }]);
    expect(await bookPayments([{ transactionId: a.ids[0], invoiceId: first.id }])).toEqual({ paidCount: 1 });

    const b = await seedTransactions([{ bankReference: "REF-SHARED", date: "2026-04-01" }]);
    expect(await bookPayments([{ transactionId: b.ids[0], invoiceId: second.id }])).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: second.id } })).toBe(0);
  });

  it("rejects an invalid payload", async () => {
    expect(await bookPayments([{ transactionId: -1, invoiceId: 1 }])).toEqual({ error: "Ungültige Eingabe." });
    expect(await bookExpenses([{ transactionId: 1.5, categoryId: null }])).toEqual({ error: "Ungültige Eingabe." });
    expect(await ignoreTransactions(["x" as unknown as number])).toEqual({ error: "Ungültige Eingabe." });
  });

  it("audits ignored entries once", async () => {
    const { ids } = await seedTransactions([{ amountCents: -100 }, { amountCents: -200 }]);
    await ignoreTransactions(ids);
    const entries = await db.prisma.auditLog.findMany({ where: { entityType: "BankStatementImport", action: "UPDATE" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].details).toContain("ignoredBankTransactionIds");
  });

  it.each(["Paid", "Draft"] as const)("skips a %s invoice", async (state) => {
    const inv = await seedInvoice(state);
    const { ids } = await seedTransactions([{ amountCents: 10000, bankReference: "REF-X" }]);

    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it("does not book an outgoing or ignored entry as a payment", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: -5000 }, { amountCents: 5000 }]);
    await ignoreTransactions([ids[1]]);

    expect(
      await bookPayments([
        { transactionId: ids[0], invoiceId: inv.id },
        { transactionId: ids[1], invoiceId: inv.id },
      ])
    ).toEqual({ paidCount: 0 });
  });

  it("turns the entry open again when its payment is deleted", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: 10000 }]);
    await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]);
    await db.prisma.payment.deleteMany({ where: { invoiceId: inv.id } });

    const row = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(row.paymentId).toBeNull();
  });

  it("books only the selected outgoing entries as expenses", async () => {
    const category = await db.prisma.category.create({ data: { name: "Telefon" } });
    const { ids } = await seedTransactions([
      { amountCents: -8990, counterparty: "Swisscom AG", description: "Rechnung März", date: "2026-03-03" },
      { amountCents: -2000, counterparty: "Migros", description: "Einkauf" },
    ]);

    expect(
      await bookExpenses([{ transactionId: ids[0], categoryId: category.categoryId }])
    ).toEqual({ expenseCount: 1 });

    const expenses = await db.prisma.expense.findMany();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount.toNumber()).toBe(89.9);
    expect(expenses[0].description).toBe("Swisscom AG – Rechnung März");
    expect(expenses[0].categoryId).toBe(category.categoryId);
    expect(expenses[0].date.toISOString().slice(0, 10)).toBe("2026-03-03");
    const linked = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(linked.expenseId).toBe(expenses[0].id);
    const untouched = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[1] } });
    expect(untouched.expenseId).toBeNull();
    expect(untouched.ignored).toBe(false);

    // Booking the same entry twice creates nothing.
    expect(await bookExpenses([{ transactionId: ids[0], categoryId: null }])).toEqual({ expenseCount: 0 });
    expect(await db.prisma.expense.count()).toBe(1);
  });

  it("does not book an incoming entry as an expense and allows no category", async () => {
    const { ids } = await seedTransactions([
      { amountCents: 5000 },
      { amountCents: -700, counterparty: "Kiosk" },
    ]);
    expect(
      await bookExpenses([
        { transactionId: ids[0], categoryId: null },
        { transactionId: ids[1], categoryId: null },
      ])
    ).toEqual({ expenseCount: 1 });
    const [expense] = await db.prisma.expense.findMany();
    expect(expense.categoryId).toBeNull();
  });

  it("ignores only open entries", async () => {
    const { ids } = await seedTransactions([{ amountCents: -100 }, { amountCents: -200 }]);
    const category = await db.prisma.category.create({ data: { name: "X" } });
    await bookExpenses([{ transactionId: ids[0], categoryId: category.categoryId }]);

    expect(await ignoreTransactions(ids)).toEqual({ ignoredCount: 1 });
    const first = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(first.ignored).toBe(false);
  });

  it("undoes an untouched import and refuses one with a booked entry", async () => {
    const untouched = await seedTransactions([{ amountCents: -100 }]);
    expect(await undoStatementImport(untouched.importId)).toEqual({});
    expect(await db.prisma.bankTransaction.count()).toBe(0);

    const booked = await seedTransactions([{ amountCents: -300 }]);
    await bookExpenses([{ transactionId: booked.ids[0], categoryId: null }]);
    const result = await undoStatementImport(booked.importId);
    expect(result.error).toContain("verbucht");
    expect(await db.prisma.bankTransaction.count()).toBe(1);
  });

  it("books an entry only once when two confirmations run at the same time", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: 4000 }]);

    const results = await Promise.all([
      bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]),
      bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]),
    ]);
    expect(results.map((r) => r.paidCount).sort()).toEqual([0, 1]);
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });
});
