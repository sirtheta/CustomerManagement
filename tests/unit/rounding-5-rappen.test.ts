import { describe, it, expect } from "vitest";
import {
  calculateInvoiceTotal,
  calculateItemTotal,
  roundTo5Rappen,
  splitTotals,
} from "@/lib/calculations";

describe("roundTo5Rappen", () => {
  it.each([
    [10.0, 10.0],
    [10.01, 10.0],
    [10.02, 10.0],
    [10.03, 10.05],
    [10.04, 10.05],
    [10.05, 10.05],
    [10.07, 10.05],
    [10.08, 10.1],
    [0.02, 0],
    [0.03, 0.05],
    [-10.02, -10.0],
    [-10.03, -10.05],
    [-10.08, -10.1],
  ])("rounds %f to %f", (amount, expected) => {
    expect(roundTo5Rappen(amount)).toBe(expected);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundTo5Rappen(-0.02), 0)).toBe(true);
  });

  it("rounds a credit note like its invoice, mirrored", () => {
    for (let cents = 0; cents <= 200; cents++) {
      const amount = cents / 100;
      expect(roundTo5Rappen(-amount) + 0).toBe(-roundTo5Rappen(amount) + 0);
    }
  });

  it("always lands on a multiple of 5 Rappen within 2 Rappen of the input", () => {
    for (let cents = -500; cents <= 500; cents++) {
      const rounded = Math.round(roundTo5Rappen(cents / 100) * 100);
      expect(Math.abs(rounded % 5)).toBe(0);
      expect(Math.abs(rounded - cents)).toBeLessThanOrEqual(2);
    }
  });
});

describe("calculateInvoiceTotal with roundTo5Rappen", () => {
  it("leaves the total untouched without the option", () => {
    expect(calculateInvoiceTotal([{ quantity: 1, unitPrice: 10.02 }])).toBe(10.02);
    expect(calculateInvoiceTotal([{ quantity: 1, unitPrice: 10.02 }], 0, { roundTo5Rappen: false })).toBe(10.02);
  });

  it("rounds only the total, not the items", () => {
    const items = [
      { quantity: 1, unitPrice: 10.03 },
      { quantity: 1, unitPrice: 5.04 },
    ];
    expect(calculateItemTotal(items[0])).toBe(10.03);
    expect(calculateInvoiceTotal(items, 0, { roundTo5Rappen: true })).toBe(15.05);
  });

  it("rounds after the invoice discount", () => {
    // 99.99 - 12.5 % = 87.49125 -> 87.49 -> 87.50
    expect(calculateInvoiceTotal([{ quantity: 1, unitPrice: 99.99 }], 12.5, { roundTo5Rappen: true })).toBe(87.5);
  });

  it("rounds a negative total (credit note) symmetrically", () => {
    expect(calculateInvoiceTotal([{ quantity: 1, unitPrice: -10.03 }], 0, { roundTo5Rappen: true })).toBe(-10.05);
    expect(calculateInvoiceTotal([{ quantity: 1, unitPrice: -10.02 }], 0, { roundTo5Rappen: true })).toBe(-10);
  });
});

describe("splitTotals", () => {
  it("separates discount and rounding", () => {
    expect(splitTotals(99.99, 12.5, 87.5)).toEqual({ discountAmount: 12.5, rounding: 0.01 });
  });

  it("reports no rounding when the total matches", () => {
    expect(splitTotals(100, 10, 90)).toEqual({ discountAmount: 10, rounding: 0 });
  });

  it("reports a negative rounding", () => {
    expect(splitTotals(10.02, 0, 10)).toEqual({ discountAmount: 0, rounding: -0.02 });
  });

  it("works for credit notes", () => {
    expect(splitTotals(-10.03, 0, -10.05)).toEqual({ discountAmount: 0, rounding: -0.02 });
  });
});
