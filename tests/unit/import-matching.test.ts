import { describe, expect, it } from "vitest";
import { matchStatementToInvoices, type OpenInvoice } from "@/lib/import/matching";
import type { ParsedTransaction } from "@/lib/import/types";

const PREFIX = "I-";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-01-25",
    amountCents: 12345,
    description: "Zahlung",
    counterparty: null,
    bankReference: null,
    ...overrides,
  };
}

const INVOICE_A: OpenInvoice = { id: 1, documentNumber: "I-26010042", totalAmount: 123.45 };
const INVOICE_B: OpenInvoice = { id: 2, documentNumber: "I-26010099", totalAmount: 123.45 };

describe("matchStatementToInvoices", () => {
  it("pre-selects when the documentNumber in the description and the amount both match", () => {
    const [result] = matchStatementToInvoices(
      [tx({ description: "Zahlung Rechnung I-26010042 danke" })],
      [INVOICE_A],
      PREFIX
    );
    expect(result.confidence).toBe("reference");
    expect(result.preselectedInvoiceId).toBe(1);
    expect(result.candidates).toEqual([{ invoiceId: 1, documentNumber: "I-26010042" }]);
  });

  it("finds the reference in the counterparty text too", () => {
    const [result] = matchStatementToInvoices(
      [tx({ description: "Überweisung", counterparty: "Ref I-26010042" })],
      [INVOICE_A],
      PREFIX
    );
    expect(result.confidence).toBe("reference");
    expect(result.preselectedInvoiceId).toBe(1);
  });

  it("does not pre-select when the referenced invoice's amount differs", () => {
    const [result] = matchStatementToInvoices(
      [tx({ description: "Zahlung Rechnung I-26010042", amountCents: 5000 })],
      [{ ...INVOICE_A, totalAmount: 999 }],
      PREFIX
    );
    expect(result.confidence).toBe("amount");
    expect(result.preselectedInvoiceId).toBeNull();
    expect(result.candidates).toEqual([{ invoiceId: 1, documentNumber: "I-26010042" }]);
  });

  it("offers every invoice with a matching amount when no reference is found", () => {
    const [result] = matchStatementToInvoices([tx({ description: "Vielen Dank" })], [INVOICE_A, INVOICE_B], PREFIX);
    expect(result.confidence).toBe("amount");
    expect(result.preselectedInvoiceId).toBeNull();
    expect(result.candidates.map((c) => c.invoiceId).sort()).toEqual([1, 2]);
  });

  it("reports no candidates when nothing matches", () => {
    const [result] = matchStatementToInvoices(
      [tx({ description: "Miete Januar", amountCents: 250000 })],
      [INVOICE_A],
      PREFIX
    );
    expect(result.confidence).toBe("none");
    expect(result.candidates).toEqual([]);
    expect(result.preselectedInvoiceId).toBeNull();
  });

  it("never proposes an invoice that isn't in the open list (e.g. already Paid)", () => {
    // Caller is responsible for only passing Sent/Overdue invoices; a
    // documentNumber match against an invoice absent from that list must
    // simply not surface.
    const [result] = matchStatementToInvoices(
      [tx({ description: "Zahlung Rechnung I-26010042", amountCents: 12345 })],
      [],
      PREFIX
    );
    expect(result.confidence).toBe("none");
  });

  it("drops outgoing (debit) entries — they can never be an invoice payment", () => {
    const results = matchStatementToInvoices([tx({ amountCents: -12345 })], [INVOICE_A], PREFIX);
    expect(results).toHaveLength(0);
  });
});
