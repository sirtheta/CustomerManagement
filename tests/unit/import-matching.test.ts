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

const INVOICE_A: OpenInvoice = { id: 1, documentNumber: "I-26010042", openAmount: 123.45 };
const INVOICE_B: OpenInvoice = { id: 2, documentNumber: "I-26010099", openAmount: 123.45 };

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
      [{ ...INVOICE_A, openAmount: 999 }],
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

  it("treats the total of the latest Mahnbeleg as an amount match and pre-selects with the reference", () => {
    const invoice: OpenInvoice = { id: 1, documentNumber: "I-26010042", openAmount: 123.45, reminderTotal: 133.45 };
    const [withRef] = matchStatementToInvoices(
      [tx({ amountCents: 13345, description: "Rechnung I-26010042" })],
      [invoice],
      PREFIX
    );
    expect(withRef.confidence).toBe("reference");
    expect(withRef.preselectedInvoiceId).toBe(1);

    const [amountOnly] = matchStatementToInvoices([tx({ amountCents: 13345 })], [invoice], PREFIX);
    expect(amountOnly.confidence).toBe("amount");
    expect(amountOnly.candidates).toEqual([{ invoiceId: 1, documentNumber: "I-26010042" }]);
  });

  it("still matches the plain open amount when a reminder total exists", () => {
    const invoice: OpenInvoice = { id: 1, documentNumber: "I-26010042", openAmount: 123.45, reminderTotal: 133.45 };
    const [result] = matchStatementToInvoices([tx({ amountCents: 12345 })], [invoice], PREFIX);
    expect(result.confidence).toBe("amount");
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

  it("recognises the number with spaces and without the prefix", () => {
    const [spaced] = matchStatementToInvoices(
      [tx({ description: "Rg I 2601 0042" })],
      [INVOICE_A],
      PREFIX
    );
    expect(spaced.confidence).toBe("reference");
    expect(spaced.preselectedInvoiceId).toBe(1);

    const [bare] = matchStatementToInvoices(
      [tx({ description: "Rechnung 26010042" })],
      [INVOICE_A],
      PREFIX
    );
    expect(bare.preselectedInvoiceId).toBe(1);
  });

  it("suggests the invoices of a customer named in the counterparty, but never pre-selects", () => {
    const invoice: OpenInvoice = {
      id: 7,
      documentNumber: "I-26010077",
      openAmount: 500,
      customerNames: ["Müller Bau AG", "Hans Müller"],
    };
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 40000, description: "Überweisung", counterparty: "MUELLER BAU AG" })],
      [invoice],
      PREFIX
    );
    // "MUELLER" vs "Müller" differ after normalisation; use the exact spelling below.
    expect(result.confidence).toBe("none");

    const [hit] = matchStatementToInvoices(
      [tx({ amountCents: 40000, description: "Überweisung", counterparty: "Müller Bau AG" })],
      [invoice],
      PREFIX
    );
    expect(hit.confidence).toBe("name");
    expect(hit.preselectedInvoiceId).toBeNull();
    expect(hit.candidates).toEqual([{ invoiceId: 7, documentNumber: "I-26010077" }]);
  });

  it("puts amount matches of the named customer first", () => {
    const named = (id: number, number: string, open: number): OpenInvoice => ({
      id,
      documentNumber: number,
      openAmount: open,
      customerNames: ["Acme GmbH"],
    });
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 20000, description: "Zahlung", counterparty: "Acme GmbH" })],
      [named(1, "I-26010001", 300), named(2, "I-26010002", 200)],
      PREFIX
    );
    expect(result.confidence).toBe("amount");
    expect(result.candidates.map((c) => c.invoiceId)).toEqual([2, 1]);
  });

  it("ignores very short customer names", () => {
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 1, description: "x", counterparty: "AG Bank" })],
      [{ id: 3, documentNumber: "I-26010003", openAmount: 9, customerNames: ["AG"] }],
      PREFIX
    );
    expect(result.confidence).toBe("none");
  });
});
