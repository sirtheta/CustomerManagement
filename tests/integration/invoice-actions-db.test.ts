import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Runs the real invoice/quote Server Actions against a temporary SQLite database:
// 5-Rappen rounding of stored totals (createInvoice/updateInvoice) and deleting
// a draft together with its items (deleteInvoice/deleteQuote).
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


import { createInvoice, updateInvoice, deleteInvoice, createCreditNote } from "@/app/(app)/invoices/actions";
import { deleteQuote } from "@/app/(app)/quotes/actions";
import { setSetting } from "@/app/(app)/settings/actions";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

type ItemInput = { name?: string; unitPrice: number; quantity: number; discountPercent?: number };

function itemsJson(items: ItemInput[]) {
  return JSON.stringify(
    items.map((item, i) => ({
      name: item.name ?? `Position ${i + 1}`,
      description: "",
      unit: "Piece",
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discountPercent: item.discountPercent ?? 0,
      totalAmount: 0, // recomputed server-side
      customText: "",
      categoryId: null,
    }))
  );
}

function invoiceForm(customerId: number, items: ItemInput[], discountPercent?: number) {
  const fd = new FormData();
  fd.set("customerId", String(customerId));
  fd.set("date", "2026-06-15");
  fd.set("dueDate", "2026-07-15");
  fd.set("itemsJson", itemsJson(items));
  if (discountPercent !== undefined) fd.set("discountPercent", String(discountPercent));
  return fd;
}

/** Calls an action that ends in redirect() and returns the id from the target URL. */
async function idFromRedirect(run: () => Promise<unknown>): Promise<number> {
  try {
    const result = await run();
    throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
  } catch (err) {
    if (!(err instanceof RedirectSignal)) throw err;
    const match = err.url.match(/\/invoices\/(\d+)/);
    if (!match) throw new Error(`unexpected redirect ${err.url}`);
    return Number(match[1]);
  }
}

async function expectRedirect(run: () => Promise<unknown>, url: string) {
  await expect(run()).rejects.toSatisfy((err: unknown) => err instanceof RedirectSignal && err.url === url);
}

describe("invoice actions against a real database", () => {
  const db = createTestDatabase();
  let customerId: number;

  async function setRounding(on: boolean) {
    const settings = await db.prisma.applicationSettings.findFirstOrThrow();
    await db.prisma.applicationSettings.update({
      where: { applicationSettingsId: settings.applicationSettingsId },
      data: { roundTotalTo5Rappen: on },
    });
  }

  async function total(id: number) {
    const inv = await db.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
    return {
      total: inv.totalAmount.toNumber(),
      items: inv.items.map((i) => ({ quantity: i.quantity.toNumber(), totalAmount: i.totalAmount.toNumber() })),
    };
  }

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = sessionFor("Admin");
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    customerId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
  });

  describe("5-Rappen rounding (createInvoice / updateInvoice)", () => {
    it("stores the exact total while the switch is off", async () => {
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10.02, quantity: 1 }, { unitPrice: 10.02, quantity: 1 }])));
      expect(await total(id)).toEqual({
        total: 20.04,
        items: [{ quantity: 1, totalAmount: 10.02 }, { quantity: 1, totalAmount: 10.02 }],
      });
    });

    it("rounds only the stored document total, never the items", async () => {
      await setRounding(true);
      // Item-wise rounding would give 10.00 + 10.00 = 20.00; the total 20.04 rounds to 20.05.
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10.02, quantity: 1 }, { unitPrice: 10.02, quantity: 1 }])));
      expect(await total(id)).toEqual({
        total: 20.05,
        items: [{ quantity: 1, totalAmount: 10.02 }, { quantity: 1, totalAmount: 10.02 }],
      });
    });

    it("rounds after the invoice discount", async () => {
      await setRounding(true);
      // 33.37 × 0.9 = 30.033 → 30.03 → 30.05. Rounding before the discount would give 33.35 × 0.9 = 30.02 → 30.00.
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 33.37, quantity: 1 }], 10)));
      const stored = await db.prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(stored.totalAmount.toNumber()).toBe(30.05);
      expect(stored.discountPercent.toNumber()).toBe(10);
      expect((await total(id)).items).toEqual([{ quantity: 1, totalAmount: 33.37 }]);
    });

    it("rounds down to the nearer 5 Rappen", async () => {
      await setRounding(true);
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 7.12, quantity: 1 }])));
      expect((await total(id)).total).toBe(7.1);
    });

    it("recalculates the total when a draft is updated", async () => {
      await setRounding(true);
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10.03, quantity: 1 }])));
      expect((await total(id)).total).toBe(10.05);

      await idFromRedirect(() => updateInvoice(id, {}, invoiceForm(customerId, [{ unitPrice: 7.12, quantity: 2 }])));
      expect(await total(id)).toEqual({ total: 14.25, items: [{ quantity: 2, totalAmount: 14.24 }] });

      await setRounding(false);
      await idFromRedirect(() => updateInvoice(id, {}, invoiceForm(customerId, [{ unitPrice: 7.12, quantity: 2 }])));
      expect((await total(id)).total).toBe(14.24);
    });

    it("leaves existing documents alone when the switch changes", async () => {
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10.03, quantity: 1 }])));
      const versionBefore = (await db.prisma.invoice.findUniqueOrThrow({ where: { id } })).version;

      expect(await setSetting("roundTotalTo5Rappen", true)).toEqual({ success: true });

      const after = await db.prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(after.totalAmount.toNumber()).toBe(10.03);
      expect(after.version).toBe(versionBefore);
      expect(await db.prisma.auditLog.count({ where: { entityType: "Settings", entityRef: "Rundung" } })).toBe(1);

      // Only saving the draft again applies the new rule.
      await idFromRedirect(() => updateInvoice(id, {}, invoiceForm(customerId, [{ unitPrice: 10.03, quantity: 1 }])));
      expect((await total(id)).total).toBe(10.05);
    });

    describe("credit notes", () => {
      async function sentOriginal() {
        const original = await db.prisma.invoice.create({
          data: {
            customerId,
            documentNumber: "I-26060001",
            date: new Date("2026-06-01"),
            dueDate: new Date("2026-07-01"),
            totalAmount: 100,
            state: "Sent",
            items: { create: [{ name: "Beratung", unit: "Hour", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
          },
        });
        const creditId = await idFromRedirect(() => createCreditNote(original.id));
        return { originalId: original.id, creditId };
      }

      it("stores the exact negative total while the switch is off", async () => {
        const { creditId } = await sentOriginal();
        await idFromRedirect(() => updateInvoice(creditId, {}, invoiceForm(customerId, [{ unitPrice: 10.03, quantity: 1 }])));
        expect(await total(creditId)).toEqual({ total: -10.03, items: [{ quantity: -1, totalAmount: -10.03 }] });
      });

      it("rounds mirrored to the invoice (−10.03 → −10.05, −7.12 → −7.10)", async () => {
        await setRounding(true);
        const { creditId, originalId } = await sentOriginal();
        await idFromRedirect(() => updateInvoice(creditId, {}, invoiceForm(customerId, [{ unitPrice: 10.03, quantity: 1 }])));
        expect(await total(creditId)).toEqual({ total: -10.05, items: [{ quantity: -1, totalAmount: -10.03 }] });

        await idFromRedirect(() => updateInvoice(creditId, {}, invoiceForm(customerId, [{ unitPrice: 7.12, quantity: 1 }])));
        expect((await total(creditId)).total).toBe(-7.1);

        const credit = await db.prisma.invoice.findUniqueOrThrow({ where: { id: creditId } });
        expect(credit.creditNoteForId).toBe(originalId);
        expect(credit.state).toBe("Draft");
      });
    });
  });

  describe("deleting drafts removes their items", () => {
    it("deleteInvoice deletes the draft's items and keeps the items of other documents", async () => {
      const draftId = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10, quantity: 1 }, { unitPrice: 20, quantity: 2 }])));
      const keptId = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 5, quantity: 1 }])));
      expect(await db.prisma.item.count({ where: { invoiceId: draftId } })).toBe(2);

      await expectRedirect(() => deleteInvoice(draftId), "/invoices");

      expect(await db.prisma.invoice.findUnique({ where: { id: draftId } })).toBeNull();
      expect(await db.prisma.item.count({ where: { invoiceId: draftId } })).toBe(0);
      expect(await db.prisma.item.count({ where: { invoiceId: null, quoteId: null } })).toBe(0);
      expect(await db.prisma.item.count({ where: { invoiceId: keptId } })).toBe(1);
      expect(await db.prisma.auditLog.count({ where: { action: "DELETE", entityType: "Invoice", entityId: draftId } })).toBe(1);
    });

    it("deleteInvoice refuses a sent invoice and keeps its items", async () => {
      const id = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 10, quantity: 1 }])));
      await db.prisma.invoice.update({ where: { id }, data: { state: "Sent", documentNumber: "I-26060009" } });

      const result = await deleteInvoice(id);

      expect(result.error).toBeTruthy();
      expect(await db.prisma.item.count({ where: { invoiceId: id } })).toBe(1);
    });

    it("deleteQuote deletes the quote's items and keeps the items of other documents", async () => {
      const quote = await db.prisma.quote.create({
        data: {
          customerId,
          date: new Date("2026-06-01"),
          validUntil: new Date("2026-07-01"),
          totalAmount: 30,
          state: "Draft",
          items: {
            create: [
              { name: "A", unit: "Piece", unitPrice: 10, quantity: 1, totalAmount: 10 },
              { name: "B", unit: "Piece", unitPrice: 20, quantity: 1, totalAmount: 20 },
            ],
          },
        },
      });
      const otherQuote = await db.prisma.quote.create({
        data: {
          customerId,
          date: new Date("2026-06-01"),
          validUntil: new Date("2026-07-01"),
          totalAmount: 5,
          state: "Draft",
          items: { create: [{ name: "C", unit: "Piece", unitPrice: 5, quantity: 1, totalAmount: 5 }] },
        },
      });
      const invoiceId = await idFromRedirect(() => createInvoice({}, invoiceForm(customerId, [{ unitPrice: 5, quantity: 1 }])));
      const followUp = await db.prisma.task.create({
        data: { customerId, quoteId: quote.id, title: "Offerte nachfassen", dueDate: new Date("2026-06-08") },
      });
      const otherFollowUp = await db.prisma.task.create({
        data: { customerId, quoteId: otherQuote.id, title: "Offerte nachfassen", dueDate: new Date("2026-06-08") },
      });

      await expectRedirect(() => deleteQuote(quote.id), "/quotes");

      expect((await db.prisma.task.findUniqueOrThrow({ where: { id: followUp.id } })).doneAt).not.toBeNull();
      expect((await db.prisma.task.findUniqueOrThrow({ where: { id: otherFollowUp.id } })).doneAt).toBeNull();

      expect(await db.prisma.quote.findUnique({ where: { id: quote.id } })).toBeNull();
      expect(await db.prisma.item.count({ where: { quoteId: quote.id } })).toBe(0);
      expect(await db.prisma.item.count({ where: { invoiceId: null, quoteId: null } })).toBe(0);
      expect(await db.prisma.item.count({ where: { quoteId: otherQuote.id } })).toBe(1);
      expect(await db.prisma.item.count({ where: { invoiceId } })).toBe(1);
    });
  });
});
