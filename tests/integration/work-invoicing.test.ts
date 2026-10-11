import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

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

import { createDocumentWithItems } from "@/lib/document-actions";
import {
  NO_ENTRIES_ERROR,
  WORK_ALREADY_BILLED_ERROR,
  WorkBillingError,
  claimWorkEntries,
  createInvoiceFromWorkEntries,
} from "@/lib/work-invoicing";
import { createInvoiceFromEntries } from "@/app/(app)/time/billing-actions";
import { CUSTOMER_ARCHIVED_ERROR } from "@/lib/customer-archive";

const editor = { user: { id: "2", name: "Editor", email: "e@test.ch", role: "Editor" }, expires: "2099-01-01" } as Session;

describe("billing work entries", () => {
  const db = createTestDatabase();
  let customerId: number;
  let otherCustomerId: number;
  let hourServiceId: number;
  let entryIds: number[];

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = editor;
    const p = db.prisma;
    await p.applicationSettings.create({ data: { defaultPaymentTermDays: 14, companyInfo: { create: {} } } });
    customerId = (await p.customer.create({ data: createValidTestCustomer() })).customerId;
    otherCustomerId = (await p.customer.create({ data: { ...createValidTestCustomer(), contactPerson: "Andere" } })).customerId;
    hourServiceId = (await p.service.create({ data: { name: "Gartenpflege", unit: "Hour", unitPrice: 70 } })).id;
    const make = (data: object) =>
      p.workEntry.create({
        data: { customerId, createdById: 2, date: new Date("2026-10-12T00:00:00.000Z"), unit: "Hour", quantity: 1, name: "x", ...data },
      });
    entryIds = [
      (await make({ serviceId: hourServiceId, name: "Gartenpflege", quantity: 3 })).id,
      (await make({ serviceId: hourServiceId, name: "Gartenpflege", quantity: 2, date: new Date("2026-10-14T00:00:00.000Z") })).id,
      (await make({ name: "Kies", unit: "Package", quantity: 1 })).id,
    ];
  });

  it("creates a draft with grouped items and marks the entries billed", async () => {
    const { id, entryCount } = await createInvoiceFromWorkEntries(customerId, entryIds);

    expect(entryCount).toBe(3);
    const invoice = await db.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
    expect(invoice.state).toBe("Draft");
    expect(invoice.documentNumber).toBeNull();
    expect(invoice.customerId).toBe(customerId);
    expect(invoice.items.map((i) => [i.name, Number(i.quantity), Number(i.unitPrice), Number(i.totalAmount)])).toEqual([
      ["Gartenpflege", 5, 70, 350],
      ["Kies", 1, 0, 0],
    ]);
    expect(Number(invoice.totalAmount)).toBe(350);
    // Payment term of the settings (14 days), counted from the invoice date.
    expect(Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / 86_400_000)).toBe(14);

    const entries = await db.prisma.workEntry.findMany({ where: { id: { in: entryIds } } });
    expect(entries.every((e) => e.invoiceId === id)).toBe(true);
  });

  it("uses the payment term of the customer when it has one", async () => {
    await db.prisma.customer.update({ where: { customerId }, data: { paymentTermDays: 45 } });
    const { id } = await createInvoiceFromWorkEntries(customerId, entryIds);
    const invoice = await db.prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / 86_400_000)).toBe(45);
  });

  it("rounds the total to 5 Rappen when the setting is on", async () => {
    await db.prisma.applicationSettings.updateMany({ data: { roundTotalTo5Rappen: true } });
    await db.prisma.service.update({ where: { id: hourServiceId }, data: { unitPrice: 70.03 } });
    const { id } = await createInvoiceFromWorkEntries(customerId, [entryIds[0]]);
    // 3 h x 70.03 = 210.09 -> 210.10
    expect(Number((await db.prisma.invoice.findUniqueOrThrow({ where: { id } })).totalAmount)).toBe(210.1);
  });

  it("refuses a second billing of the same entries and creates no invoice", async () => {
    await createInvoiceFromWorkEntries(customerId, entryIds);
    await expect(createInvoiceFromWorkEntries(customerId, entryIds)).rejects.toThrow(WORK_ALREADY_BILLED_ERROR);
    expect(await db.prisma.invoice.count()).toBe(1);
  });

  it("refuses entries of another customer", async () => {
    const foreign = await db.prisma.workEntry.create({
      data: { customerId: otherCustomerId, createdById: 2, date: new Date("2026-10-12T00:00:00.000Z"), name: "Y", unit: "Hour", quantity: 1 },
    });
    await expect(createInvoiceFromWorkEntries(customerId, [...entryIds, foreign.id])).rejects.toThrow(WORK_ALREADY_BILLED_ERROR);
    expect(await db.prisma.invoice.count()).toBe(0);
    expect(await db.prisma.workEntry.count({ where: { invoiceId: { not: null } } })).toBe(0);
  });

  it("refuses an empty selection and an archived customer", async () => {
    await expect(createInvoiceFromWorkEntries(customerId, [])).rejects.toThrow(NO_ENTRIES_ERROR);
    await db.prisma.customer.update({ where: { customerId }, data: { archivedAt: new Date() } });
    await expect(createInvoiceFromWorkEntries(customerId, entryIds)).rejects.toThrow(CUSTOMER_ARCHIVED_ERROR);
  });

  it("rolls everything back when an entry is claimed between the check and the update", async () => {
    // The hook is what claims the entries; if it finds fewer rows than expected, no invoice may remain.
    await expect(
      createDocumentWithItems(
        { kind: "invoice", customerId, customUserText: null, date: new Date(), dueDate: new Date(), totalAmount: 0, discountPercent: 0, items: [] },
        {
          onCreated: async () => {
            throw new WorkBillingError(WORK_ALREADY_BILLED_ERROR);
          },
        }
      )
    ).rejects.toBeInstanceOf(WorkBillingError);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("does not claim an entry that was edited after it was read", async () => {
    const read = await db.prisma.workEntry.findMany({ where: { id: { in: entryIds } } });
    await new Promise((resolve) => setTimeout(resolve, 5)); // make sure updatedAt moves on
    await db.prisma.workEntry.update({ where: { id: entryIds[0] }, data: { quantity: 9 } });
    const invoice = await db.prisma.invoice.create({
      data: { customerId, date: new Date(), dueDate: new Date(), totalAmount: 0, state: "Draft" },
    });

    const claim = db.prisma.$transaction((tx) => claimWorkEntries(tx, customerId, read, invoice.id));
    await expect(claim).rejects.toBeInstanceOf(WorkBillingError);
    await expect(claim).rejects.toThrow(WORK_ALREADY_BILLED_ERROR);
    // The two unchanged entries were matched too, but the rollback leaves all three open.
    expect(await db.prisma.workEntry.count({ where: { invoiceId: { not: null } } })).toBe(0);
  });

  it("claims a very large selection (no SQLite expression depth limit)", async () => {
    const date = new Date("2026-10-12T00:00:00.000Z");
    await db.prisma.workEntry.createMany({
      data: Array.from({ length: 1100 }, () => ({
        customerId,
        createdById: 2,
        date,
        name: "Bulk",
        unit: "Piece" as const,
        quantity: 1,
      })),
    });
    const bulk = await db.prisma.workEntry.findMany({ where: { name: "Bulk" }, select: { id: true, updatedAt: true } });
    expect(bulk).toHaveLength(1100);
    const invoice = await db.prisma.invoice.create({
      data: { customerId, date: new Date(), dueDate: new Date(), totalAmount: 0, state: "Draft" },
    });

    await db.prisma.$transaction((tx) => claimWorkEntries(tx, customerId, bulk, invoice.id));

    expect(await db.prisma.workEntry.count({ where: { name: "Bulk", invoiceId: invoice.id } })).toBe(1100);
  });

  it("frees the entries again when the draft is deleted", async () => {
    const { id } = await createInvoiceFromWorkEntries(customerId, entryIds);
    await db.prisma.item.deleteMany({ where: { invoiceId: id } });
    await db.prisma.invoice.delete({ where: { id } });
    expect(await db.prisma.workEntry.count({ where: { invoiceId: null } })).toBe(3);
  });

  describe("createInvoiceFromEntries action", () => {
    const formFor = (ids: number[]) => {
      const fd = new FormData();
      for (const id of ids) fd.append("entryId", String(id));
      return fd;
    };

    it("redirects to the new draft and audits the source", async () => {
      await expect(createInvoiceFromEntries(customerId, {}, formFor(entryIds))).rejects.toThrow(/^redirect \/invoices\/\d+$/);
      const invoice = await db.prisma.invoice.findFirstOrThrow();
      const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { entityType: "Invoice", action: "CREATE" } });
      expect(audit.entityId).toBe(invoice.id);
      expect(JSON.parse(audit.details!)).toEqual({ fromWorkEntries: 3 });
    });

    it("returns the error message instead of throwing for a billed selection", async () => {
      await createInvoiceFromWorkEntries(customerId, entryIds);
      const result = await createInvoiceFromEntries(customerId, {}, formFor(entryIds));
      expect(result).toEqual({ error: WORK_ALREADY_BILLED_ERROR });
    });

    it("creates only one invoice when the same selection is submitted twice at once", async () => {
      const results = await Promise.allSettled([
        createInvoiceFromEntries(customerId, {}, formFor(entryIds)),
        createInvoiceFromEntries(customerId, {}, formFor(entryIds)),
      ]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createInvoiceFromEntries>>> => r.status === "fulfilled");
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0].reason as Error).message)).toMatch(/^redirect \/invoices\/\d+$/);
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value).toEqual({ error: WORK_ALREADY_BILLED_ERROR });

      expect(await db.prisma.invoice.count()).toBe(1);
      const invoice = await db.prisma.invoice.findFirstOrThrow();
      const entries = await db.prisma.workEntry.findMany({ where: { id: { in: entryIds } } });
      expect(entries.every((e) => e.invoiceId === invoice.id)).toBe(true);
    });

    it("redirects viewers", async () => {
      holder.session = { user: { id: "3", name: "V", email: "v@test.ch", role: "Viewer" }, expires: "2099-01-01" } as Session;
      await expect(createInvoiceFromEntries(customerId, {}, formFor(entryIds))).rejects.toThrow("redirect /dashboard");
      expect(await db.prisma.invoice.count()).toBe(0);
    });
  });
});
