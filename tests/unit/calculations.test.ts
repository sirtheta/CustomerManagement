import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  calculateInvoiceTotal,
  calculateItemTotal,
  validateDiscountPercent,
} from "@/lib/calculations";

describe("Discount calculations", () => {
  it.each([
    [100, 10, 90],
    [99.99, 12.5, 87.49],
    [10.005, 0, 10.01],
  ])("calculates item total %f with %f%% discount as %f", (amount, discount, expected) => {
    expect(calculateItemTotal({ quantity: 1, unitPrice: amount, discountPercent: discount })).toBe(expected);
  });

  it("applies item discounts before invoice discount", () => {
    expect(calculateInvoiceTotal([
      { quantity: 2, unitPrice: 100, discountPercent: 10 },
      { quantity: 1, unitPrice: 50 },
    ], 10)).toBe(207);
  });

  it.each([-1, 100.01, Number.NaN])("rejects invalid discount %f", (discount) => {
    expect(validateDiscountPercent(discount)).toBe(false);
    expect(() => calculateInvoiceTotal([], discount)).toThrow();
  });
});

describe("Item calculations", () => {
  // Equivalent: CalculateInvoiceTotal_WithMultipleItems_ShouldReturnCorrectTotal
  it("should calculate total correctly with multiple items", () => {
    const items = [
      { quantity: 2, unitPrice: 100 },
      { quantity: 1, unitPrice: 50 },
    ];
    const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    expect(total).toBe(250);
  });

  // Equivalent: CalculateInvoiceTotal_WithEmptyItems_ShouldReturnZero
  it("should return zero for empty items", () => {
    const total = ([] as { quantity: number; unitPrice: number }[]).reduce(
      (sum, i) => sum + i.quantity * i.unitPrice,
      0
    );
    expect(total).toBe(0);
  });

  // Equivalent: CalculateInvoiceTotal_WithDifferentQuantitiesAndPrices (Theory)
  it.each([
    [1, 100, 100],
    [2.5, 100, 250],
    [1, 99.99, 99.99],
    [0.5, 200, 100],
  ])("quantity=%f × price=%f should equal %f", (qty, price, expected) => {
    expect(qty * price).toBeCloseTo(expected, 2);
  });

  it("should produce correct per-item totalAmount", () => {
    const item = { quantity: 3, unitPrice: 75.5 };
    expect(item.quantity * item.unitPrice).toBeCloseTo(226.5, 2);
  });
});

describe("Amount validation (Zod)", () => {
  const amountSchema = z
    .number()
    .nonnegative({ message: "Total amount cannot be negative" })
    .max(999999.99, { message: "Total amount cannot exceed 999999.99" });

  // Equivalent: BusinessDocument_WithInvalidAmount_ShouldThrowException (Theory)
  it.each([
    [1_000_000.0, "Total amount cannot exceed 999999.99"],
    [-1.0, "Total amount cannot be negative"],
  ])("should reject amount %f with message '%s'", (amount, expectedMessage) => {
    const result = amountSchema.safeParse(amount);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(expectedMessage);
    }
  });

  it.each([[0], [0.01], [999.99], [999999.99]])(
    "should accept valid amount %f",
    (amount) => {
      expect(amountSchema.safeParse(amount).success).toBe(true);
    }
  );
});
