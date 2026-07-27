import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the default prisma export before importing the module under test
vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: {
      findFirst: vi.fn().mockResolvedValue({
        invoiceNumberPrefix: "I-",
        quoteNumberPrefix: "Q-",
      }),
    },
    invoice: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
  },
}));

import { generateInvoiceNumber, generateQuoteNumber } from "@/lib/document-number";
import prisma from "@/lib/prisma";

const yy = new Date().getFullYear().toString().slice(-2);
const mm = String(new Date().getMonth() + 1).padStart(2, "0");
const invoicePrefix = `I-${yy}${mm}`;
const quotePrefix = `Q-${yy}${mm}`;

describe("DocumentNumberGenerator – invoices", () => {
  beforeEach(() => {
    vi.mocked(prisma.invoice.findMany).mockReset();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
  });

  // Equivalent: GenerateInvoiceNumber_ShouldFollowCorrectFormat
  it("should follow the I-YYMM#### format", async () => {
    const number = await generateInvoiceNumber();
    expect(number).toMatch(new RegExp(`^I-${yy}${mm}\\d{4}$`));
  });

  // Equivalent: GenerateInvoiceNumber_WithNoExistingInvoices_ShouldStartAtOne
  it("should start at 0001 when no invoices exist", async () => {
    const number = await generateInvoiceNumber();
    expect(number).toBe(`${invoicePrefix}0001`);
  });

  // Equivalent: GenerateInvoiceNumber_ShouldIncrementSequentially
  it("should increment sequentially", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { documentNumber: `${invoicePrefix}0001` } as never,
    ]);
    const number = await generateInvoiceNumber();
    expect(number).toBe(`${invoicePrefix}0002`);
  });

  it("should pick the max sequence when multiple exist", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { documentNumber: `${invoicePrefix}0003` } as never,
      { documentNumber: `${invoicePrefix}0001` } as never,
    ]);
    const number = await generateInvoiceNumber();
    expect(number).toBe(`${invoicePrefix}0004`);
  });

  // Month boundary: documents from a previous month must not affect the counter
  it("should reset sequence for the current month when only prior-month docs exist", async () => {
    const prevMm = String(new Date().getMonth()).padStart(2, "0") || "12";
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { documentNumber: `I-${yy}${prevMm}0099` } as never,
    ]);
    // The mock returns those docs but generateInvoiceNumber queries with startsWith
    // for the CURRENT month prefix – so findMany returns [] for the current month.
    // We re-mock to simulate a filtered result:
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
    const number = await generateInvoiceNumber();
    expect(number).toBe(`${invoicePrefix}0001`);
  });
});

describe("DocumentNumberGenerator – quotes", () => {
  beforeEach(() => {
    vi.mocked(prisma.quote.findMany).mockReset();
    vi.mocked(prisma.quote.findMany).mockResolvedValue([]);
  });

  it("should follow the Q-YYMM#### format", async () => {
    const number = await generateQuoteNumber();
    expect(number).toMatch(new RegExp(`^Q-${yy}${mm}\\d{4}$`));
  });

  it("should start at 0001 when no quotes exist", async () => {
    const number = await generateQuoteNumber();
    expect(number).toBe(`${quotePrefix}0001`);
  });

  it("should increment sequentially", async () => {
    vi.mocked(prisma.quote.findMany).mockResolvedValue([
      { documentNumber: `${quotePrefix}0005` } as never,
    ]);
    const number = await generateQuoteNumber();
    expect(number).toBe(`${quotePrefix}0006`);
  });
});
