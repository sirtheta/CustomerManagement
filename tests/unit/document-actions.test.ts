import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    invoice: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    quote: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    item: { createMany: vi.fn(), deleteMany: vi.fn() },
    invoiceSentLog: { create: vi.fn() },
    pendingEmail: { deleteMany: vi.fn() },
    sentDocument: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    quoteSentLog: { create: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/document-number", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/document-number")>()),
  generateInvoiceNumber: vi.fn(),
  generateQuoteNumber: vi.fn(),
  assignDocumentNumber: vi.fn(),
}));
vi.mock("@/lib/credit-notes", async () => ({
  CreditNoteError: class extends Error {},
  assertCreditWithinOriginal: vi.fn(),
}));
vi.mock("@/lib/payments", () => ({ syncInvoiceState: vi.fn() }));
vi.mock("@/lib/service-catalog", () => ({ saveItemsToCatalog: vi.fn() }));
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: vi.fn(),
  generateQuotePdf: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendInvoiceEmail: vi.fn(),
  sendQuoteEmail: vi.fn(),
}));
vi.mock("@/lib/document-archive", () => ({
  archivePdf: vi.fn().mockResolvedValue({ path: "2026/x.pdf", sha256: "a".repeat(64), size: 3 }),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  createDocumentWithItems,
  updateDocumentWithItems,
  DocumentLockedError,
  sendDocument,
} from "@/lib/document-actions";
import prisma from "@/lib/prisma";
import { generateInvoiceNumber, generateQuoteNumber, assignDocumentNumber } from "@/lib/document-number";
import { generateInvoicePdf, generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/email";
import { assertCreditWithinOriginal, CreditNoteError } from "@/lib/credit-notes";
import { syncInvoiceState } from "@/lib/payments";
import { logAudit } from "@/lib/audit";
import { archivePdf } from "@/lib/document-archive";

const actor = { user: { id: "1", name: "Editor", email: "editor@test.ch", role: "Editor" } } as never;

describe("createDocumentWithItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma)
    );
  });

  it("creates an invoice draft without a number", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 7 } as never);
    const result = await createDocumentWithItems({
      kind: "invoice",
      customerId: 1,
      customUserText: null,
      date: new Date(),
      dueDate: new Date(),
      totalAmount: 0,
      discountPercent: 0,
      items: [],
    });
    expect(result).toEqual({ id: 7, documentNumber: null });
    expect(generateInvoiceNumber).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.invoice.create).mock.calls[0][0].data).not.toHaveProperty("documentNumber");
  });

  it("creates a quote draft without a number", async () => {
    vi.mocked(prisma.quote.create).mockResolvedValue({ id: 9 } as never);
    const result = await createDocumentWithItems({
      kind: "quote",
      customerId: 1,
      customUserText: null,
      date: new Date(),
      validUntil: new Date(),
      totalAmount: 100,
      discountPercent: 5,
      items: [],
    });
    expect(result).toEqual({ id: 9, documentNumber: null });
    expect(generateQuoteNumber).not.toHaveBeenCalled();
    expect(prisma.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountPercent: 5 }) })
    );
    expect(vi.mocked(prisma.quote.create).mock.calls[0][0].data).not.toHaveProperty("documentNumber");
  });

  it("does not retry on a non-collision error", async () => {
    vi.mocked(prisma.invoice.create).mockRejectedValue(new Error("DB down"));

    await expect(
      createDocumentWithItems({
        kind: "invoice",
        customerId: 1,
        customUserText: null,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        discountPercent: 0,
        items: [],
      })
    ).rejects.toThrow("DB down");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
  });
});

describe("updateDocumentWithItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma)
    );
  });

  it("persists discountPercent for a quote update", async () => {
    vi.mocked(prisma.item.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.quote.update).mockResolvedValue({} as never);

    await updateDocumentWithItems(3, {
      kind: "quote",
      customerId: 1,
      customUserText: null,
      date: new Date(),
      validUntil: new Date(),
      totalAmount: 200,
      discountPercent: 10,
      items: [],
    });

    expect(prisma.item.deleteMany).toHaveBeenCalledWith({ where: { quoteId: 3 } });
    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountPercent: 10 }) })
    );
  });

  const invoiceInput = {
    kind: "invoice" as const,
    customerId: 1,
    customUserText: null,
    date: new Date(),
    dueDate: new Date(),
    totalAmount: 100,
    discountPercent: 0,
    items: [],
  };

  it("refuses to update an invoice that has left Draft", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Sent" } as never);

    await expect(updateDocumentWithItems(3, invoiceInput)).rejects.toBeInstanceOf(DocumentLockedError);
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("updates a draft invoice", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Draft" } as never);
    vi.mocked(prisma.item.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    await updateDocumentWithItems(3, invoiceInput);

    expect(prisma.invoice.update).toHaveBeenCalledTimes(1);
  });
});

describe("sendDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((arg) => {
      if (Array.isArray(arg)) return Promise.all(arg) as never;
      return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) as never;
    });
  });

  it("sends a credit note, then recalculates the original invoice", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 5,
      documentNumber: null,
      creditNoteForId: 1,
      totalAmount: -50,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-2026-002");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "invoice", id: 5, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(assertCreditWithinOriginal).toHaveBeenCalled();
    expect(syncInvoiceState).toHaveBeenCalledWith({ invoiceId: 1, actor, source: "credit-note" });
    expect(logAudit).toHaveBeenCalledWith(actor, "SEND", "Invoice", 5, "I-2026-002", {
      to: "a@b.ch",
      creditNoteFor: 1,
    });
    // the send must not have assigned a number before the check passed
    expect(vi.mocked(assertCreditWithinOriginal).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assignDocumentNumber).mock.invocationCallOrder[0]
    );
  });

  it("does not send or number a credit note that exceeds the original", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 5, documentNumber: null, creditNoteForId: 1, totalAmount: -500, customer: {}, items: [],
    } as never);
    vi.mocked(assertCreditWithinOriginal).mockRejectedValue(new CreditNoteError("Zu hoch."));

    const result = await sendDocument({ kind: "invoice", id: 5, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result).toEqual({ error: "Zu hoch." });
    expect(assignDocumentNumber).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("returns an error when settings are missing", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
    const result = await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });
    expect(result.error).toBe("Einstellungen nicht konfiguriert.");
  });

  it("sends an invoice, marks it Sent, and logs the audit entry", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 1,
      documentNumber: "I-2026-001",
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-2026-001");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(prisma.invoiceSentLog.create).toHaveBeenCalledWith({
      data: { invoiceId: 1, sentTo: "a@b.ch", subject: "s" },
    });
    expect(prisma.pendingEmail.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 1 } });
  });

  it.each(["Paid", "PartiallyPaid", "Canceled"])(
    "resending a %s invoice does not set the state to Sent",
    async () => {
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: 1,
        documentNumber: "I-2026-001",
        customer: {},
        items: [],
      } as never);
      vi.mocked(assignDocumentNumber).mockResolvedValue("I-2026-001");
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

      await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

      const arg = vi.mocked(prisma.invoice.updateMany).mock.calls[0][0]!;
      expect(arg.where).toEqual({ id: 1, state: { in: ["Draft", "Sent", "Overdue"] } });
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    }
  );

  it("sends a quote without touching the analytics cache tag", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 2,
      documentNumber: "Q-2026-001",
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("Q-2026-001");
    vi.mocked(generateQuotePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendQuoteEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "quote", id: 2, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(prisma.quoteSentLog.create).toHaveBeenCalledWith({
      data: { quoteId: 2, sentTo: "a@b.ch", subject: "s" },
    });
  });

  it("assigns the number before rendering and fills the placeholder", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 1,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({
      kind: "invoice",
      id: 1,
      to: "a@b.ch",
      subject: "Rechnung {documentNumber}",
      body: "Nr. {documentNumber}",
      actor,
    });

    expect(result.success).toBe(true);
    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 1, { actor });
    expect(vi.mocked(assignDocumentNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(generateInvoicePdf).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(generateInvoicePdf).mock.calls[0][0]).toMatchObject({ documentNumber: "R-26090001" });
    expect(sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: "R-26090001" }),
      expect.anything(),
      expect.anything(),
      { to: "a@b.ch", subject: "Rechnung R-26090001", body: "Nr. R-26090001" }
    );
    expect(prisma.invoiceSentLog.create).toHaveBeenCalledWith({
      data: { invoiceId: 1, sentTo: "a@b.ch", subject: "Rechnung R-26090001" },
    });
  });

  it("keeps the assigned number when the mail fails", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 2,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("O-26090001");
    vi.mocked(generateQuotePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendQuoteEmail).mockRejectedValue(new Error("SMTP down"));

    const result = await sendDocument({ kind: "quote", id: 2, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("SMTP down");
    expect(assignDocumentNumber).toHaveBeenCalledWith("quote", 2, { actor });
    expect(prisma.quote.update).not.toHaveBeenCalled();
    expect(prisma.quoteSentLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["invoice", "Rechnungsnummer konnte nicht vergeben werden."],
    ["quote", "Offertennummer konnte nicht vergeben werden."],
  ] as const)("returns an error and sends nothing when number assignment fails (%s)", async (kind, message) => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 1,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 1,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockRejectedValue(new Error("DB down"));

    const result = await sendDocument({ kind, id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe(message);
    expect(result.success).toBeUndefined();
    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(generateQuotePdf).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(sendQuoteEmail).not.toHaveBeenCalled();
    expect(prisma.invoiceSentLog.create).not.toHaveBeenCalled();
    expect(prisma.quoteSentLog.create).not.toHaveBeenCalled();
  });

  it("archives the invoice PDF and records a SentDocument in the same transaction", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 1, documentNumber: "I-1", customer: {}, items: [] } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-1");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    vi.mocked(prisma.$transaction).mockImplementation((arg: unknown) => Promise.all(arg as Promise<unknown>[]) as never);

    await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(archivePdf).toHaveBeenCalledWith(expect.objectContaining({ documentNumber: "I-1", kind: "Invoice" }));
    expect(prisma.sentDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoiceId: 1, kind: "Invoice", sha256: "a".repeat(64), createdById: 1 }),
    });
  });

  it("does not send or change state when archiving fails", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 1, documentNumber: "I-1", customer: {}, items: [] } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-1");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(archivePdf).mockRejectedValueOnce(new Error("EACCES"));

    const result = await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(prisma.sentDocument.create).not.toHaveBeenCalled();
  });
});
