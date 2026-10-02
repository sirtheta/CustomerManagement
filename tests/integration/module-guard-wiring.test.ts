import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { MODULE_FIELDS, MODULE_KEYS, type ModuleKey } from "@/lib/modules";

// tests/setup.ts replaces lib/module-guard with an "all on" stub. Here the real
// guard runs against a temporary database, so switching a module off in
// ApplicationSettings must make its Server Actions redirect to /dashboard and its
// API routes answer 404, without touching any data. The table below was taken
// from `requireModule(` / `moduleDisabledResponse(` in app/; the static check of
// that wiring lives in tests/unit/module-guard-coverage.test.ts.
vi.mock("@/lib/module-guard", async (importOriginal) => importOriginal());

const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
const { RedirectSignal } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  },
}));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { deleteTask } from "@/app/(app)/customers/task-actions";
import { deleteSubscription } from "@/app/(app)/customers/subscription-actions";
import { discardPendingEmail } from "@/app/(app)/invoices/pending/actions";
import { deleteQuote } from "@/app/(app)/quotes/actions";
import { dismissReminder } from "@/app/(app)/invoices/reminders/actions";
import { ignoreTransactions, undoStatementImport } from "@/app/(app)/invoices/import/actions";
import { deleteExpense } from "@/app/(app)/accounting/actions";
import AnalyticsPage from "@/app/(app)/analytics/page";
import { GET as quotePdf } from "@/app/api/quotes/[id]/pdf/route";
import { GET as quotesExport } from "@/app/api/export/quotes/route";
import { GET as reminderPdf } from "@/app/api/reminders/[id]/pdf/route";
import { GET as accountingExport } from "@/app/api/export/accounting/route";
import { GET as receivablesExport } from "@/app/api/export/receivables/route";
import { GET as yearPackage } from "@/app/api/export/year-package/route";
import { GET as expenseReceipt } from "@/app/api/expenses/receipts/[id]/route";

const DISABLED_TEXT = "Dieses Modul ist deaktiviert.";

type Fixture = {
  customerId: number;
  taskId: number;
  subscriptionId: number;
  pendingEmailId: number;
  quoteId: number;
  reminderId: number;
  importId: number;
  transactionId: number;
  expenseId: number;
  receiptId: number;
};

const admin = { user: { id: "1", name: "Admin", email: "a@test.ch", role: "Admin" }, expires: "2099-01-01" } as Session;

describe("module switches reach actions and routes (real guard)", () => {
  const db = createTestDatabase();
  let f: Fixture;

  async function setModule(key: ModuleKey, on: boolean) {
    await db.prisma.applicationSettings.updateMany({ data: { [MODULE_FIELDS[key]]: on } });
  }

  /** Everything the actions below could change. */
  async function snapshot() {
    const p = db.prisma;
    return {
      tasks: await p.task.findMany({ orderBy: { id: "asc" } }),
      subscriptions: await p.subscription.findMany({ orderBy: { id: "asc" } }),
      pendingEmails: await p.pendingEmail.findMany({ orderBy: { id: "asc" } }),
      invoices: await p.invoice.findMany({ orderBy: { id: "asc" } }),
      quotes: await p.quote.findMany({ orderBy: { id: "asc" } }),
      items: await p.item.findMany({ orderBy: { id: "asc" } }),
      reminders: await p.pendingReminder.findMany({ orderBy: { id: "asc" } }),
      imports: await p.bankStatementImport.findMany({ orderBy: { id: "asc" } }),
      transactions: await p.bankTransaction.findMany({ orderBy: { id: "asc" } }),
      expenses: await p.expense.findMany({ orderBy: { id: "asc" } }),
      receipts: await p.expenseReceipt.count(),
      audit: await p.auditLog.count(),
    };
  }

  async function outcome(run: () => Promise<unknown>): Promise<{ redirect?: string; value?: unknown }> {
    try {
      return { value: await run() };
    } catch (err) {
      if (err instanceof RedirectSignal) return { redirect: err.url };
      throw err;
    }
  }

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = admin;
    const p = db.prisma;
    await p.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    const customerId = (await p.customer.create({ data: createValidTestCustomer() })).customerId;
    const task = await p.task.create({ data: { customerId, title: "Nachfassen", dueDate: new Date("2026-06-01") } });
    const subscription = await p.subscription.create({
      data: { customerId, interval: "Yearly", nextInvoiceDate: new Date("2027-01-01") },
    });
    const draft = await p.invoice.create({
      data: { customerId, date: new Date("2026-06-01"), dueDate: new Date("2026-07-01"), totalAmount: 50, state: "Draft" },
    });
    const pendingEmail = await p.pendingEmail.create({
      data: { invoiceId: draft.id, to: "jane@clientag.ch", subject: "Rechnung", body: "Text" },
    });
    const quote = await p.quote.create({
      data: {
        customerId,
        date: new Date("2026-06-01"),
        validUntil: new Date("2026-07-01"),
        totalAmount: 10,
        state: "Draft",
        items: { create: [{ name: "A", unit: "Piece", unitPrice: 10, quantity: 1, totalAmount: 10 }] },
      },
    });
    const overdue = await p.invoice.create({
      data: {
        customerId,
        documentNumber: "I-26050001",
        date: new Date("2026-05-01"),
        dueDate: new Date("2026-05-31"),
        totalAmount: 100,
        state: "Overdue",
      },
    });
    const reminder = await p.pendingReminder.create({ data: { invoiceId: overdue.id } });
    const statement = await p.bankStatementImport.create({
      data: { filename: "camt.xml", importedCount: 1, skippedCount: 0 },
    });
    const transaction = await p.bankTransaction.create({
      data: { importId: statement.id, fingerprint: "fp-1", date: new Date("2026-06-02"), amountRappen: -2000, description: "Miete" },
    });
    const expense = await p.expense.create({
      data: { date: new Date("2026-06-03"), description: "Büromaterial", amount: 20 },
    });
    const receipt = await p.expenseReceipt.create({
      data: { expenseId: expense.id, name: "beleg.pdf", fileType: "pdf", size: 3, content: Buffer.from("abc") },
    });
    f = {
      customerId,
      taskId: task.id,
      subscriptionId: subscription.id,
      pendingEmailId: pendingEmail.id,
      quoteId: quote.id,
      reminderId: reminder.id,
      importId: statement.id,
      transactionId: transaction.id,
      expenseId: expense.id,
      receiptId: receipt.id,
    };
  });

  type ActionCase = {
    module: ModuleKey;
    name: string;
    run: () => Promise<unknown>;
    /** false: with the module on the call does not change data (e.g. needs more setup); only the guard is checked. */
    changesWhenOn?: boolean;
  };

  const actionCases: ActionCase[] = [
    { module: "tasks", name: "deleteTask", run: () => deleteTask(f.customerId, f.taskId) },
    { module: "subscriptions", name: "deleteSubscription", run: () => deleteSubscription(f.customerId, f.subscriptionId) },
    { module: "subscriptions", name: "discardPendingEmail", run: () => discardPendingEmail(f.pendingEmailId) },
    { module: "quotes", name: "deleteQuote", run: () => deleteQuote(f.quoteId) },
    { module: "reminders", name: "dismissReminder", run: () => dismissReminder(f.reminderId) },
    { module: "bankImport", name: "ignoreTransactions", run: () => ignoreTransactions([f.transactionId]) },
    { module: "bankImport", name: "undoStatementImport", run: () => undoStatementImport(f.importId) },
    { module: "accounting", name: "deleteExpense", run: () => deleteExpense(f.expenseId) },
    // Analytics has no Server Action and no API route; its page is the only entry point.
    {
      module: "analytics",
      name: "AnalyticsPage",
      run: () => AnalyticsPage({ searchParams: Promise.resolve({}) }),
      changesWhenOn: false,
    },
  ];

  it("covers every module", () => {
    expect(new Set(actionCases.map((c) => c.module))).toEqual(new Set(MODULE_KEYS));
  });

  describe.each(actionCases)("$module: $name", (c) => {
    it("redirects to /dashboard and changes nothing while the module is off", async () => {
      await setModule(c.module, false);
      const before = await snapshot();

      expect(await outcome(c.run)).toEqual({ redirect: "/dashboard" });

      expect(await snapshot()).toEqual(before);
    });

    if (c.changesWhenOn !== false) {
      it("does its work once the module is on (the off case is not vacuous)", async () => {
        // Switch the other modules off: only the own one must matter.
        for (const key of MODULE_KEYS) await setModule(key, key === c.module);
        const before = await snapshot();

        const result = await outcome(c.run);

        expect(result.redirect).not.toBe("/dashboard");
        expect(await snapshot()).not.toEqual(before);
      });
    }
  });

  type RouteCase = {
    module: ModuleKey;
    name: string;
    call: () => Promise<Response>;
    /** Cheap enough to also call with the module on. */
    checkOn?: boolean;
  };
  const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
  const routeCases: RouteCase[] = [
    { module: "quotes", name: "GET /api/quotes/[id]/pdf", call: () => quotePdf(new Request("http://t/") as never, params(f.quoteId)) },
    { module: "quotes", name: "GET /api/export/quotes", call: () => quotesExport(new Request("http://t/api/export/quotes")), checkOn: true },
    { module: "reminders", name: "GET /api/reminders/[id]/pdf", call: () => reminderPdf(new Request("http://t/") as never, params(f.reminderId)) },
    { module: "accounting", name: "GET /api/export/accounting", call: () => accountingExport(new Request("http://t/api/export/accounting?year=2026")), checkOn: true },
    { module: "accounting", name: "GET /api/export/receivables", call: () => receivablesExport(new Request("http://t/api/export/receivables")), checkOn: true },
    { module: "accounting", name: "GET /api/export/year-package", call: () => yearPackage(new Request("http://t/api/export/year-package?year=2026") as never) },
    { module: "accounting", name: "GET /api/expenses/receipts/[id]", call: () => expenseReceipt(new Request("http://t/"), params(f.receiptId)), checkOn: true },
  ];

  describe.each(routeCases)("$module: $name", (c) => {
    it("answers 404 and changes nothing while the module is off", async () => {
      await setModule(c.module, false);
      const before = await snapshot();

      const res = await c.call();

      expect(res.status).toBe(404);
      expect(await res.text()).toBe(DISABLED_TEXT);
      expect(await snapshot()).toEqual(before);
    });

    if (c.checkOn) {
      it("answers normally once the module is on", async () => {
        for (const key of MODULE_KEYS) await setModule(key, key === c.module);
        const res = await c.call();
        expect(res.status).toBe(200);
        expect(await res.text()).not.toBe(DISABLED_TEXT);
      });
    }
  });
});
