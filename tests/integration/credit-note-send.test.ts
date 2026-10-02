import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// sendDocument, assignDocumentNumber, syncInvoiceState and logAudit all use the
// default prisma singleton. Route it to the per-suite test database.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    { get: (_t, prop) => (holder.prisma as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
// Only the outside world is mocked: PDF rendering and SMTP delivery.
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: vi.fn(async () => Buffer.from("pdf")),
  generateQuotePdf: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/email", () => ({
  sendInvoiceEmail: vi.fn(async () => {}),
  sendQuoteEmail: vi.fn(async () => {}),
}));

import { sendDocument } from "@/lib/document-actions";
import { sendInvoiceEmail } from "@/lib/email";
import { createCreditNoteDraft } from "@/lib/credit-notes";
import { getPaymentSummary } from "@/lib/payments";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;

describe("sendDocument for credit notes against a real database", () => {
  const db = createTestDatabase();

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.mocked(sendInvoiceEmail).mockClear();
    const company = await db.prisma.companyInformation.create({ data: { companyName: "Test AG" } });
    await db.prisma.applicationSettings.create({ data: { companyInformationId: company.companyInformationId } });
  });

  async function seedSentInvoice(total = 100) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-ORIG",
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state: "Sent",
        items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
      },
    });
  }

  async function draftCredit(originalId: number, amount: number, customerId: number) {
    const id = await createCreditNoteDraft(originalId, db.prisma);
    // Drafts are not limit-checked at save time, so set the amount directly.
    await db.prisma.invoice.update({ where: { id }, data: { totalAmount: -amount, customerId } });
    return id;
  }

  const send = (id: number) =>
    sendDocument({ kind: "invoice", id, to: "kunde@example.ch", subject: "Gutschrift", body: "Text", actor });

  it("a full credit note gets a number, is Sent, cancels the unpaid original and is audited", async () => {
    const original = await seedSentInvoice(100);
    const creditId = await createCreditNoteDraft(original.id, db.prisma);

    expect(await send(creditId)).toEqual({ success: true });

    const credit = await db.prisma.invoice.findUniqueOrThrow({ where: { id: creditId } });
    expect(credit.state).toBe("Sent");
    expect(credit.documentNumber).toMatch(/^I-/);
    expect(credit.documentNumber).not.toBe("I-ORIG");
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);

    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: original.id } })).state).toBe("Canceled");
    expect((await getPaymentSummary(original.id, db.prisma)).remainingRappen).toBe(0);

    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "SEND", entityType: "Invoice", entityId: creditId },
    });
    expect(JSON.parse(audit.details as string)).toMatchObject({ creditNoteFor: original.id });
  });

  it("a partial credit note leaves the original Sent with the rest open", async () => {
    const original = await seedSentInvoice(100);
    const creditId = await draftCredit(original.id, 40, original.customerId);

    expect(await send(creditId)).toEqual({ success: true });

    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: original.id } })).state).toBe("Sent");
    expect((await getPaymentSummary(original.id, db.prisma)).remainingRappen).toBe(6000);
  });

  it("enforces the credit limit at send time", async () => {
    const original = await seedSentInvoice(100);
    const first = await draftCredit(original.id, 70, original.customerId);
    const second = await draftCredit(original.id, 70, original.customerId);

    expect(await send(first)).toEqual({ success: true });
    vi.mocked(sendInvoiceEmail).mockClear();

    const result = await send(second);
    expect(result.error).toBe("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
    expect(sendInvoiceEmail).not.toHaveBeenCalled();

    const rejected = await db.prisma.invoice.findUniqueOrThrow({ where: { id: second } });
    expect(rejected.state).toBe("Draft");
    expect(rejected.documentNumber).toBeNull();
    expect((await getPaymentSummary(original.id, db.prisma)).remainingRappen).toBe(3000);
  });

  it("sending a normal invoice is unchanged", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        date: new Date(),
        dueDate: new Date("2099-01-01"),
        totalAmount: 100,
        state: "Draft",
        items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
      },
    });

    expect(await send(invoice.id)).toEqual({ success: true });

    const sent = await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(sent.state).toBe("Sent");
    expect(sent.documentNumber).toMatch(/^I-/);
  });
});
