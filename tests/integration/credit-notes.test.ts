import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer, createValidItemList } from "../test-utils";
import type { Session } from "next-auth";
import { syncInvoiceState, getPaymentSummary } from "@/lib/payments";
import { createCreditNoteDraft, assertCreditWithinOriginal, CreditNoteError } from "@/lib/credit-notes";

const actor = { user: { id: "1", name: "Tester", email: "t@example.ch" } } as Session;

describe("credit notes against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(state: "Draft" | "Sent" | "Canceled" = "Sent", total = 200) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
        items: { create: createValidItemList() },
      },
    });
  }

  it("copies the items negated into a draft credit note", async () => {
    const original = await seedInvoice();
    const id = await createCreditNoteDraft(original.id, db.prisma);

    const credit = await db.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(credit.state).toBe("Draft");
    expect(credit.documentNumber).toBeNull();
    expect(credit.creditNoteForId).toBe(original.id);
    expect(credit.totalAmount.toNumber()).toBe(-200);
    expect(credit.items.length).toBeGreaterThan(0);
    expect(credit.items.every((i) => i.quantity.toNumber() < 0 && i.totalAmount.toNumber() < 0)).toBe(true);
  });

  it.each(["Draft", "Canceled"] as const)("refuses a credit note for a %s invoice", async (state) => {
    const original = await seedInvoice(state);
    await expect(createCreditNoteDraft(original.id, db.prisma)).rejects.toBeInstanceOf(CreditNoteError);
  });

  it("refuses a credit note for a credit note", async () => {
    const original = await seedInvoice();
    const creditId = await createCreditNoteDraft(original.id, db.prisma);
    await db.prisma.invoice.update({ where: { id: creditId }, data: { state: "Sent", documentNumber: "R-CN1" } });
    await expect(createCreditNoteDraft(creditId, db.prisma)).rejects.toBeInstanceOf(CreditNoteError);
  });

  it("caps the sum of credit notes at the original total", async () => {
    const original = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        documentNumber: "R-CN-A",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -70,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });
    const draft = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -40,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });

    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: -40 })
    ).rejects.toThrow("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: -30 })
    ).resolves.toBeUndefined();
  });

  it("does not count an already sent credit note twice when it is checked again", async () => {
    const original = await seedInvoice("Sent", 100);
    const sent = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        documentNumber: "R-CN-B",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -100,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: sent.id, creditNoteForId: original.id, totalAmount: -100 })
    ).resolves.toBeUndefined();
  });

  it("refuses a credit note without an amount", async () => {
    const original = await seedInvoice();
    const draft = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 0,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: 0 })
    ).rejects.toThrow("Die Gutschrift muss einen Betrag haben.");
  });

  it("refuses a credit note with a positive (charging) total", async () => {
    const original = await seedInvoice("Sent", 200);
    const draft = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: 100 })
    ).rejects.toBeInstanceOf(CreditNoteError);
  });

  it("a sent full credit note cancels the unpaid original; a partial one lowers the open amount", async () => {
    const full = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: full.customerId, documentNumber: "R-CN-F", date: new Date(), dueDate: new Date(),
        totalAmount: -100, state: "Sent", creditNoteForId: full.id,
      },
    });
    expect((await syncInvoiceState({ invoiceId: full.id, actor, source: "credit-note" }, db.prisma)).state).toBe("Canceled");

    const partial = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: partial.customerId, documentNumber: "R-CN-P", date: new Date(), dueDate: new Date(),
        totalAmount: -25, state: "Sent", creditNoteForId: partial.id,
      },
    });
    expect((await syncInvoiceState({ invoiceId: partial.id, actor, source: "credit-note" }, db.prisma)).state).toBe("Sent");
    expect((await getPaymentSummary(partial.id, db.prisma)).remainingRappen).toBe(7500);
  });
});
