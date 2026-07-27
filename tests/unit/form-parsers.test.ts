import { describe, it, expect } from "vitest";
import { parseDocumentItems } from "@/lib/form-parsers";

function makeFormData(itemsJson: string): FormData {
  const fd = new FormData();
  fd.append("itemsJson", itemsJson);
  return fd;
}

const validItem = {
  name: "Beratung",
  description: "",
  unit: "Hour" as const,
  unitPrice: 100,
  quantity: 2,
  totalAmount: 200,
  customText: "",
  categoryId: null,
};

describe("parseDocumentItems", () => {
  it("parses valid items and computes total", () => {
    const fd = makeFormData(JSON.stringify([validItem]));
    const { items, totalAmount } = parseDocumentItems(fd);
    expect(items).toHaveLength(1);
    expect(totalAmount).toBe(200);
  });

  it("returns empty items and 0 total for empty array", () => {
    const fd = makeFormData("[]");
    const { items, totalAmount } = parseDocumentItems(fd);
    expect(items).toHaveLength(0);
    expect(totalAmount).toBe(0);
  });

  it("returns empty items and 0 total when field is absent", () => {
    const fd = new FormData();
    const { items, totalAmount } = parseDocumentItems(fd);
    expect(items).toHaveLength(0);
    expect(totalAmount).toBe(0);
  });

  it("sums multiple items correctly", () => {
    const items = [
      { ...validItem, totalAmount: 150 },
      { ...validItem, totalAmount: 75 },
    ];
    const fd = makeFormData(JSON.stringify(items));
    const { totalAmount } = parseDocumentItems(fd);
    expect(totalAmount).toBe(225);
  });

  it("throws on malformed JSON", () => {
    const fd = makeFormData("not-json");
    expect(() => parseDocumentItems(fd)).toThrow();
  });

  it("throws on invalid item schema (missing required field)", () => {
    const fd = makeFormData(JSON.stringify([{ name: "X" }]));
    expect(() => parseDocumentItems(fd)).toThrow();
  });
});
