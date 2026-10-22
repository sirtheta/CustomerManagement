import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Real invoice/quote/settings Server Actions against a temporary SQLite database:
// the selected sender profile is stored per document and travels to credit notes
// and to invoices converted from a quote.
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
import { deleteSenderProfile } from "@/app/(app)/settings/sender-profiles/actions";

const session = { user: { id: "1", name: "Test", email: "test@example.com", role: "Admin" }, expires: "2099-01-01" } as Session;

const itemsJson = JSON.stringify([
  { name: "Pos", description: "", unit: "Piece", unitPrice: 100, quantity: 1, discountPercent: 0, totalAmount: 0, customText: "", categoryId: null },
]);

function form(customerId: number, senderProfileId?: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("customerId", String(customerId));
  fd.set("date", "2026-06-15");
  fd.set("dueDate", "2026-07-15");
  fd.set("validUntil", "2026-07-15");
  fd.set("itemsJson", itemsJson);
  if (senderProfileId !== undefined) fd.set("senderProfileId", senderProfileId);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
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

describe("sender profiles against a real database", () => {
  const db = createTestDatabase();
  let customerId: number;
  let erika: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = session;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    customerId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
    erika = (await db.prisma.senderProfile.create({ data: { name: "Erika", companyHolderName: "Erika Muster" } })).id;
  });

  const invoiceProfile = async (id: number) =>
    (await db.prisma.invoice.findUniqueOrThrow({ where: { id }, select: { senderProfileId: true } })).senderProfileId;

  it("takes the first profile (null) when nothing is selected", async () => {
    const withoutField = idFrom(await redirectTarget(() => createInvoice({}, form(customerId))));
    const emptyField = idFrom(await redirectTarget(() => createInvoice({}, form(customerId, ""))));
    expect(await invoiceProfile(withoutField)).toBeNull();
    expect(await invoiceProfile(emptyField)).toBeNull();
  });

  it("stores the selected profile and lets a draft switch back to the first one", async () => {
    const id = idFrom(await redirectTarget(() => createInvoice({}, form(customerId, String(erika)))));
    expect(await invoiceProfile(id)).toBe(erika);

    await redirectTarget(() => updateInvoice(id, {}, form(customerId, "")));
    expect(await invoiceProfile(id)).toBeNull();
  });

  it("refuses an unknown profile and an inactive one for new documents", async () => {
    expect(await createInvoice({}, form(customerId, "9999"))).toEqual({ error: expect.stringContaining("existiert nicht mehr") });
    await db.prisma.senderProfile.update({ where: { id: erika }, data: { isActive: false } });
    expect(await createInvoice({}, form(customerId, String(erika)))).toEqual({ error: expect.stringContaining("inaktiv") });
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("keeps an inactive profile on the draft that already uses it", async () => {
    const id = idFrom(await redirectTarget(() => createInvoice({}, form(customerId, String(erika)))));
    await db.prisma.senderProfile.update({ where: { id: erika }, data: { isActive: false } });
    await redirectTarget(() => updateInvoice(id, {}, form(customerId, String(erika))));
    expect(await invoiceProfile(id)).toBe(erika);
  });

  it("gives a credit note the profile of its original and ignores the form field", async () => {
    const original = await db.prisma.invoice.create({
      data: {
        customerId,
        documentNumber: "I-1",
        date: new Date("2026-01-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: 100,
        state: "Sent",
        senderProfileId: erika,
        items: { create: [{ name: "Pos", unit: "Piece", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
      },
    });
    const creditId = idFrom(await redirectTarget(() => createCreditNote(original.id)));
    expect(await invoiceProfile(creditId)).toBe(erika);

    await redirectTarget(() => updateInvoice(creditId, {}, form(customerId, "", { dueDate: "" })));
    expect(await invoiceProfile(creditId)).toBe(erika);
  });

  it("carries the profile of a quote over to the invoice created from it", async () => {
    const quoteId = idFrom(await redirectTarget(() => createQuote({}, form(customerId, String(erika)))));
    expect((await db.prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).senderProfileId).toBe(erika);

    const target = await redirectTarget(() => convertQuoteToInvoice(quoteId));
    expect(await invoiceProfile(idFrom(target))).toBe(erika);
  });

  it("deletes an unused profile but keeps one that documents still use", async () => {
    await redirectTarget(() => createInvoice({}, form(customerId, String(erika))));
    expect(await deleteSenderProfile(erika)).toEqual({ error: expect.stringContaining("noch verwendet") });
    expect(await db.prisma.senderProfile.count()).toBe(1);

    const unused = await db.prisma.senderProfile.create({ data: { name: "Ungenutzt" } });
    expect(await deleteSenderProfile(unused.id)).toEqual({});
    expect(await db.prisma.senderProfile.findUnique({ where: { id: unused.id } })).toBeNull();
  });
});
