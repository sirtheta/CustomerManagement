import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Real invoice/quote Server Actions against a temporary SQLite database: the topic
// is normalised on save and travels to credit notes and to invoices converted from a quote.
const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
const { RedirectSignal } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { createInvoice, updateInvoice, createCreditNote } from "@/app/(app)/invoices/actions";
import { createQuote, convertQuoteToInvoice } from "@/app/(app)/quotes/actions";

const session = { user: { id: "1", name: "Test", email: "test@example.com", role: "Admin" }, expires: "2099-01-01" } as Session;

const itemsJson = JSON.stringify([
  { name: "Pos", description: "", unit: "Piece", unitPrice: 100, quantity: 1, discountPercent: 0, totalAmount: 0, customText: "", categoryId: null },
]);

function form(customerId: number, topic?: string) {
  const fd = new FormData();
  fd.set("customerId", String(customerId));
  fd.set("date", "2026-06-15");
  fd.set("dueDate", "2026-07-15");
  fd.set("validUntil", "2026-07-15");
  fd.set("itemsJson", itemsJson);
  if (topic !== undefined) fd.set("topic", topic);
  return fd;
}

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = await run();
    throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
  } catch (err) {
    if (err instanceof RedirectSignal) return err.url;
    throw err;
  }
}
const idFrom = (url: string) => Number(url.match(/\/(\d+)/)![1]);

describe("document topic against a real database", () => {
  const db = createTestDatabase();
  let customerId: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = session;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    customerId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
  });

  const invoiceTopic = async (id: number) =>
    (await db.prisma.invoice.findUniqueOrThrow({ where: { id }, select: { topic: true } })).topic;

  it("stores the topic on one line and clears it when emptied", async () => {
    const id = idFrom(await redirectTarget(() => createInvoice({}, form(customerId, "  Hosting\n 2027 "))));
    expect(await invoiceTopic(id)).toBe("Hosting 2027");

    await redirectTarget(() => updateInvoice(id, {}, form(customerId, "   ")));
    expect(await invoiceTopic(id)).toBeNull();

    const withoutField = idFrom(await redirectTarget(() => createInvoice({}, form(customerId))));
    expect(await invoiceTopic(withoutField)).toBeNull();
  });

  it("cuts the topic to 100 characters", async () => {
    const id = idFrom(await redirectTarget(() => createInvoice({}, form(customerId, "x".repeat(150)))));
    expect(await invoiceTopic(id)).toBe("x".repeat(100));
  });

  it("gives a credit note the topic of its original", async () => {
    const original = await db.prisma.invoice.create({
      data: {
        customerId,
        documentNumber: "I-1",
        topic: "Domain example.ch",
        date: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: 100,
        state: "Sent",
        items: { create: [{ name: "Pos", unit: "Piece", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
      },
    });
    const creditId = idFrom(await redirectTarget(() => createCreditNote(original.id)));
    expect(await invoiceTopic(creditId)).toBe("Domain example.ch");
  });

  it("carries the topic of a quote over to the invoice created from it", async () => {
    const quoteId = idFrom(await redirectTarget(() => createQuote({}, form(customerId, "Installation Office"))));
    expect((await db.prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).topic).toBe("Installation Office");

    const target = await redirectTarget(() => convertQuoteToInvoice(quoteId));
    expect(await invoiceTopic(idFrom(target))).toBe("Installation Office");
  });
});
