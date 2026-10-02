import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The pickers hide archived customers, but Server Actions also receive crafted
// customer ids. New documents, subscriptions and tasks must be refused for an
// archived customer; existing drafts keep working for their own customer.
const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect ${url}`);
  }),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { createInvoice, updateInvoice } from "@/app/(app)/invoices/actions";
import { createQuote, updateQuote, convertQuoteToInvoice } from "@/app/(app)/quotes/actions";
import { createSubscription } from "@/app/(app)/customers/subscription-actions";
import { createTask } from "@/app/(app)/customers/task-actions";
import { CUSTOMER_ARCHIVED_ERROR } from "@/lib/customer-archive";

const ARCHIVED_MESSAGE = "Der Kunde ist archiviert. Bitte zuerst wiederherstellen.";

function documentForm(customerId: number | string) {
  const fd = new FormData();
  fd.set("customerId", String(customerId));
  fd.set("date", "2026-06-15");
  fd.set("dueDate", "2026-07-15");
  fd.set("validUntil", "2026-07-15");
  fd.set("itemsJson", JSON.stringify([]));
  return fd;
}

async function redirectUrl(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const match = (err as Error).message.match(/^redirect (.+)$/);
    if (match) return match[1];
    throw err;
  }
  throw new Error("expected a redirect");
}

describe("archived customers in Server Actions", () => {
  const db = createTestDatabase();
  let activeId: number;
  let archivedId: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = {
      user: { id: "1", name: "Test", email: "t@example.com", role: "Admin" },
      expires: "2099-01-01",
    } as Session;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    activeId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
    archivedId = (
      await db.prisma.customer.create({
        data: { ...createValidTestCustomer(), contactPerson: "Archiv", archivedAt: new Date() },
      })
    ).customerId;
  });

  it("exports the message used by every refusal", () => {
    expect(CUSTOMER_ARCHIVED_ERROR).toBe(ARCHIVED_MESSAGE);
  });

  describe("invoices", () => {
    it("createInvoice refuses an archived customer and creates nothing", async () => {
      expect(await createInvoice({}, documentForm(archivedId))).toEqual({ error: ARCHIVED_MESSAGE });
      expect(await db.prisma.invoice.count()).toBe(0);
    });

    it("createInvoice refuses an unknown customer", async () => {
      expect(await createInvoice({}, documentForm(9999))).toEqual({ error: "Kunde nicht gefunden." });
      expect(await db.prisma.invoice.count()).toBe(0);
    });

    it("createInvoice still works for an active customer", async () => {
      expect(await redirectUrl(() => createInvoice({}, documentForm(activeId)))).toMatch(/^\/invoices\/\d+$/);
    });

    it("updateInvoice refuses moving a draft to an archived customer", async () => {
      const draft = await db.prisma.invoice.create({
        data: { customerId: activeId, date: new Date(), dueDate: new Date(), totalAmount: 0, state: "Draft" },
      });
      expect(await updateInvoice(draft.id, {}, documentForm(archivedId))).toEqual({ error: ARCHIVED_MESSAGE });
      expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).customerId).toBe(activeId);
    });

    it("updateInvoice still saves a draft of a customer archived later", async () => {
      const draft = await db.prisma.invoice.create({
        data: { customerId: archivedId, date: new Date(), dueDate: new Date(), totalAmount: 0, state: "Draft" },
      });
      expect(await redirectUrl(() => updateInvoice(draft.id, {}, documentForm(archivedId)))).toBe(
        `/invoices/${draft.id}`
      );
    });
  });

  describe("quotes", () => {
    it("createQuote refuses an archived customer and creates nothing", async () => {
      expect(await createQuote({}, documentForm(archivedId))).toEqual({ error: ARCHIVED_MESSAGE });
      expect(await db.prisma.quote.count()).toBe(0);
    });

    it("updateQuote refuses moving a quote to an archived customer", async () => {
      const quote = await db.prisma.quote.create({
        data: { customerId: activeId, date: new Date(), validUntil: new Date(), totalAmount: 0, state: "Draft" },
      });
      expect(await updateQuote(quote.id, {}, documentForm(archivedId))).toEqual({ error: ARCHIVED_MESSAGE });
      expect((await db.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).customerId).toBe(activeId);
    });

    it("updateQuote still saves a quote of a customer archived later", async () => {
      const quote = await db.prisma.quote.create({
        data: { customerId: archivedId, date: new Date(), validUntil: new Date(), totalAmount: 0, state: "Draft" },
      });
      expect(await redirectUrl(() => updateQuote(quote.id, {}, documentForm(archivedId)))).toBe(
        `/quotes/${quote.id}`
      );
    });

    it("convertQuoteToInvoice refuses an archived customer and leaves the quote untouched", async () => {
      const quote = await db.prisma.quote.create({
        data: { customerId: archivedId, date: new Date(), validUntil: new Date(), totalAmount: 0, state: "Sent" },
      });
      expect(await convertQuoteToInvoice(quote.id)).toEqual({ error: ARCHIVED_MESSAGE });
      expect(await db.prisma.invoice.count()).toBe(0);
      const after = await db.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(after.state).toBe("Sent");
      expect(after.documentNumber).toBeNull();
    });

    it("convertQuoteToInvoice works for an active customer", async () => {
      const quote = await db.prisma.quote.create({
        data: { customerId: activeId, date: new Date(), validUntil: new Date(), totalAmount: 0, state: "Sent" },
      });
      expect(await redirectUrl(() => convertQuoteToInvoice(quote.id))).toMatch(/^\/invoices\/\d+$/);
    });
  });

  describe("subscriptions", () => {
    function subscriptionForm() {
      const fd = new FormData();
      fd.set("interval", "Monthly");
      fd.set("nextInvoiceDate", "2027-01-01");
      return fd;
    }

    it("createSubscription refuses an archived customer", async () => {
      expect(await createSubscription(archivedId, {}, subscriptionForm())).toEqual({ error: ARCHIVED_MESSAGE });
      expect(await db.prisma.subscription.count()).toBe(0);
    });

    it("createSubscription works for an active customer", async () => {
      expect((await createSubscription(activeId, {}, subscriptionForm())).success).toBe(true);
      expect(await db.prisma.subscription.count({ where: { customerId: activeId } })).toBe(1);
    });
  });

  describe("tasks", () => {
    function taskForm() {
      const fd = new FormData();
      fd.set("title", "Anrufen");
      fd.set("dueDate", "2027-01-01");
      return fd;
    }

    it("createTask refuses an archived customer", async () => {
      expect(await createTask(archivedId, {}, taskForm())).toEqual({ error: ARCHIVED_MESSAGE });
      expect(await db.prisma.task.count()).toBe(0);
    });

    it("createTask works for an active customer", async () => {
      expect((await createTask(activeId, {}, taskForm())).success).toBe(true);
      expect(await db.prisma.task.count({ where: { customerId: activeId } })).toBe(1);
    });
  });
});
