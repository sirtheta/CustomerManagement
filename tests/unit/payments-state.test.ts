import { describe, it, expect } from "vitest";
import { computeInvoiceState, toRappen } from "@/lib/payments";

const future = new Date("2099-01-01");
const past = new Date("2000-01-01");
const base = { totalRappen: 10000, dueDate: future };

describe("toRappen", () => {
  it("rounds floating point noise", () => {
    expect(toRappen(0.1 + 0.2)).toBe(30);
    expect(toRappen(123.45)).toBe(12345);
    expect(toRappen({ toNumber: () => 19.99 })).toBe(1999);
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
});
