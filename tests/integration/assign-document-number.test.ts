import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { assignDocumentNumber } from "@/lib/document-number";

vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;

describe("assignDocumentNumber", () => {
  const db = createTestDatabase();
  const yy = String(new Date().getFullYear()).slice(-2);
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");

  async function draftInvoice(documentNumber: string | null = null) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
  }

  it("assigns the next number of the current month to an invoice draft", async () => {
    await db.prisma.applicationSettings.deleteMany();
    const invoice = await draftInvoice();

    const number = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });

    expect(number).toBe(`R-${yy}${mm}0001`);
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBe(number);
  });

  it("is idempotent: a second call returns the same number", async () => {
    const invoice = await draftInvoice();
    const first = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    const second = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    expect(second).toBe(first);
  });

  it("keeps an existing (legacy) number", async () => {
    const invoice = await draftInvoice("R-25010007");
    expect(await assignDocumentNumber("invoice", invoice.id, { client: db.prisma })).toBe("R-25010007");
  });

  it("does not leave a gap when an unnumbered draft is deleted", async () => {
    const deleted = await draftInvoice();
    const kept = await draftInvoice();
    await db.prisma.invoice.delete({ where: { id: deleted.id } });

    expect(await assignDocumentNumber("invoice", kept.id, { client: db.prisma })).toBe(`R-${yy}${mm}0001`);
  });

  it("numbers sequentially across concurrent calls", async () => {
    const a = await draftInvoice();
    const b = await draftInvoice();
    const numbers = await Promise.all([
      assignDocumentNumber("invoice", a.id, { client: db.prisma }),
      assignDocumentNumber("invoice", b.id, { client: db.prisma }),
    ]);
    expect(new Set(numbers).size).toBe(2);
  });

  it("assigns quote numbers with the quote prefix", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const quote = await db.prisma.quote.create({
      data: {
        customerId: customer.customerId,
        date: new Date(),
        validUntil: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
    expect(await assignDocumentNumber("quote", quote.id, { client: db.prisma })).toBe(`O-${yy}${mm}0001`);
  });

  it("writes an UPDATE audit entry only when a number is newly assigned", async () => {
    const invoice = await draftInvoice();
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });

    const entries = await db.prisma.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "UPDATE", entityType: "Invoice", entityId: invoice.id });
  });

  it("throws for an unknown id", async () => {
    await expect(assignDocumentNumber("invoice", 999_999, { client: db.prisma })).rejects.toThrow(
      "Dokument nicht gefunden."
    );
  });
});
