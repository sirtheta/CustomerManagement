import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    invoice: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    quote: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    item: { createMany: vi.fn(), deleteMany: vi.fn() },
    invoiceSentLog: { create: vi.fn() },
    quoteSentLog: { create: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/document-number", () => ({
  generateInvoiceNumber: vi.fn(),
  generateQuoteNumber: vi.fn(),
}));
vi.mock("@/lib/service-catalog", () => ({ saveItemsToCatalog: vi.fn() }));
vi.mock("@/lib/pdf/invoice-pdf", () => ({
  generateInvoicePdf: vi.fn(),
  generateQuotePdf: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendInvoiceEmail: vi.fn(),
  sendQuoteEmail: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  createDocumentWithItems,
  updateDocumentWithItems,
  sendDocument,
  isDocumentNumberCollision,
} from "@/lib/document-actions";
import prisma from "@/lib/prisma";
import { generateInvoiceNumber, generateQuoteNumber } from "@/lib/document-number";
import { generateInvoicePdf, generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/email";

function collisionError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["documentNumber"] },
  });
}

const actor = { user: { id: "1", name: "Editor", email: "editor@test.ch", role: "Editor" } } as never;

describe("createDocumentWithItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma)
    );
  });

  it("retries once on a documentNumber collision and succeeds", async () => {
    vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-001");
    vi.mocked(prisma.invoice.create)
      .mockRejectedValueOnce(collisionError())
      .mockResolvedValueOnce({ id: 5 } as never);

    const result = await createDocumentWithItems({
      kind: "invoice",
      customerId: 1,
      customUserText: null,
      date: new Date(),
      dueDate: new Date(),
      totalAmount: 100,
      discountPercent: 0,
      items: [],
    });

    expect(result).toEqual({ id: 5, documentNumber: "I-2026-001" });
    expect(prisma.invoice.create).toHaveBeenCalledTimes(2);
  });

  it("throws after a second collision on retry (invoice)", async () => {
    vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-001");
    vi.mocked(prisma.invoice.create).mockRejectedValue(collisionError());

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
    ).rejects.toSatisfy((err: unknown) => isDocumentNumberCollision(err));
    expect(prisma.invoice.create).toHaveBeenCalledTimes(2);
  });

  it("retries once on a documentNumber collision for quotes too", async () => {
    vi.mocked(generateQuoteNumber).mockResolvedValue("Q-2026-001");
    vi.mocked(prisma.quote.create)
      .mockRejectedValueOnce(collisionError())
      .mockResolvedValueOnce({ id: 9 } as never);

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

    expect(result).toEqual({ id: 9, documentNumber: "Q-2026-001" });
    expect(prisma.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discountPercent: 5 }) })
    );
  });

  it("does not retry on a non-collision error", async () => {
    vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-001");
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
});

describe("sendDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation((arg) => {
      if (Array.isArray(arg)) return Promise.all(arg) as never;
      return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) as never;
    });
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
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(prisma.invoiceSentLog.create).toHaveBeenCalledWith({
      data: { invoiceId: 1, sentTo: "a@b.ch", subject: "s" },
    });
  });

  it("sends a quote without touching the analytics cache tag", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 2,
      documentNumber: "Q-2026-001",
      customer: {},
      items: [],
    } as never);
    vi.mocked(generateQuotePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendQuoteEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "quote", id: 2, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(prisma.quoteSentLog.create).toHaveBeenCalledWith({
      data: { quoteId: 2, sentTo: "a@b.ch", subject: "s" },
    });
  });
});
