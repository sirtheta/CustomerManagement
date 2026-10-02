import { describe, it, expect } from "vitest";
import { computeInvoiceState } from "@/lib/payments";
import { toRappen } from "@/lib/calculations";

const future = new Date("2099-01-01");
const past = new Date("2000-01-01");
const base = { totalRappen: 10000, dueDate: future };

describe("toRappen", () => {
  it("rounds floating point noise", () => {
    expect(toRappen(0.1 + 0.2)).toBe(30);
    expect(toRappen(123.45)).toBe(12345);
    expect(toRappen({ toNumber: () => 19.99 })).toBe(1999);
  });

  it("keeps the sign of negative amounts (credit notes)", () => {
    expect(toRappen(-180.05)).toBe(-18005);
  });
});

describe("computeInvoiceState", () => {
  it("is Paid when payments cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 10000 })).toBe("Paid");
  });
  it("is Paid on overpayment", () => {
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 12000 })).toBe("Paid");
  });
  it("is PartiallyPaid for a partial sum", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 1 })).toBe("PartiallyPaid");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 9999 })).toBe("PartiallyPaid");
  });
  it("falls back to Sent when all payments are gone and not due", () => {
    expect(computeInvoiceState({ ...base, state: "Paid", paidRappen: 0 })).toBe("Sent");
    expect(computeInvoiceState({ ...base, state: "PartiallyPaid", paidRappen: 0 })).toBe("Sent");
  });
  it("falls back to Overdue when all payments are gone and due date passed", () => {
    expect(
      computeInvoiceState({ ...base, dueDate: past, state: "Paid", paidRappen: 0 })
    ).toBe("Overdue");
  });
  it("leaves unpaid Sent/Overdue untouched", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0 })).toBe("Sent");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 0 })).toBe("Overdue");
  });
  it("never changes Draft or Canceled", () => {
    expect(computeInvoiceState({ ...base, state: "Draft", paidRappen: 10000 })).toBe("Draft");
    expect(computeInvoiceState({ ...base, state: "Canceled", paidRappen: 10000 })).toBe("Canceled");
  });
  it("does not mark a zero-total invoice Paid without a payment", () => {
    expect(computeInvoiceState({ ...base, totalRappen: 0, state: "Sent", paidRappen: 0 })).toBe("Sent");
  });
  it("is Canceled when credit notes cover the total and nothing was paid", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0, creditedRappen: 10000 })).toBe("Canceled");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 0, creditedRappen: 12000 })).toBe("Canceled");
  });
  it("is Paid when payments plus credit notes cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 7000, creditedRappen: 3000 })).toBe("Paid");
  });
  it("is Paid when a paid invoice is fully credited (overpaid, refund due)", () => {
    expect(computeInvoiceState({ ...base, state: "Paid", paidRappen: 10000, creditedRappen: 10000 })).toBe("Paid");
  });
  it("stays Sent for a partial credit without payments", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0, creditedRappen: 4000 })).toBe("Sent");
  });
  it("is PartiallyPaid when payments plus credit do not cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 3000, creditedRappen: 4000 })).toBe("PartiallyPaid");
  });
});
