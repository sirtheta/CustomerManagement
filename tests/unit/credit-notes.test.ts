import { describe, it, expect } from "vitest";
import { negateDocumentInput } from "@/lib/credit-notes";

const item = {
  name: "Beratung",
  description: "",
  unit: "Hour" as const,
  unitPrice: 100,
  quantity: 2,
  discountPercent: 10,
  totalAmount: 180,
  customText: "",
  categoryId: null,
};

describe("negateDocumentInput", () => {
  it("negates quantities, item totals and the document total but keeps unit prices and discounts", () => {
    const out = negateDocumentInput({ items: [item], totalAmount: 180, discountPercent: 0 });
    expect(out.totalAmount).toBe(-180);
    expect(out.items[0].quantity).toBe(-2);
    expect(out.items[0].totalAmount).toBe(-180);
    expect(out.items[0].unitPrice).toBe(100);
    expect(out.items[0].discountPercent).toBe(10);
  });

  it("does not turn zero into negative zero", () => {
    const out = negateDocumentInput({ items: [], totalAmount: 0 });
    expect(Object.is(out.totalAmount, -0)).toBe(false);
  });
});
