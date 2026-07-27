import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  parseCategoryParam,
  categoryParamValue,
  groupByCategory,
  combineCategoryAmounts,
  yearBounds,
  monthBounds,
} from "@/app/(app)/analytics/lib/analytics-queries";

describe("categoryParamValue", () => {
  it("encodes null as 'none'", () => {
    expect(categoryParamValue(null)).toBe("none");
  });

  it("encodes a numeric id as a string", () => {
    expect(categoryParamValue(7)).toBe("7");
  });
});

describe("yearBounds", () => {
  it("returns UTC midnight Jan 1 of the given year as start", () => {
    const { start } = yearBounds(2025);
    expect(start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns UTC midnight Jan 1 of the following year as end", () => {
    const { end } = yearBounds(2025);
    expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("start < end for any year", () => {
    const { start, end } = yearBounds(2023);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});

describe("monthBounds", () => {
  it("returns UTC midnight on the first of the given month as start", () => {
    const { start } = monthBounds(2025, 0);
    expect(start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns UTC midnight on the first of the next month as end", () => {
    const { end } = monthBounds(2025, 0);
    expect(end.toISOString()).toBe("2025-02-01T00:00:00.000Z");
  });

  it("handles December correctly (rolls over to next year)", () => {
    const { start, end } = monthBounds(2025, 11);
    expect(start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("start < end for every month", () => {
    for (let m = 0; m < 12; m++) {
      const { start, end } = monthBounds(2025, m);
      expect(start.getTime()).toBeLessThan(end.getTime());
    }
  });
});

describe("parseCategoryParam", () => {
  it("returns undefined when the param is absent", () => {
    expect(parseCategoryParam(undefined)).toBeUndefined();
  });

  it("maps 'none' to null (uncategorized)", () => {
    expect(parseCategoryParam("none")).toBeNull();
  });

  it("parses a numeric id", () => {
    expect(parseCategoryParam("3")).toBe(3);
  });

  it("returns undefined for a malformed value instead of NaN", () => {
    expect(parseCategoryParam("abc")).toBeUndefined();
  });
});

describe("groupByCategory", () => {
  it("sums amounts per category and sorts descending by total", () => {
    const result = groupByCategory([
      { amount: 100, category: { categoryId: 1, name: "Beratung", colorHex: "#fff" } },
      { amount: 50, category: { categoryId: 1, name: "Beratung", colorHex: "#fff" } },
      { amount: 200, category: { categoryId: 2, name: "Material", colorHex: "#000" } },
    ]);

    expect(result).toEqual([
      { categoryId: 2, name: "Material", color: "#000", total: 200 },
      { categoryId: 1, name: "Beratung", color: "#fff", total: 150 },
    ]);
  });

  it("groups uncategorized rows under a null key with the fallback label and color", () => {
    const result = groupByCategory([
      { amount: 30, category: null },
      { amount: 20, category: null },
    ]);

    expect(result).toEqual([
      { categoryId: null, name: "Ohne Kategorie", color: "#64748b", total: 50 },
    ]);
  });
});

describe("combineCategoryAmounts", () => {
  it("merges income and expenses per category and sums them into a total", () => {
    const result = combineCategoryAmounts(
      [
        { categoryId: 1, name: "Beratung", color: "#fff", total: 150 },
        { categoryId: 2, name: "Material", color: "#000", total: 50 },
      ],
      [
        { categoryId: 2, name: "Material", color: "#000", total: 200 },
        { categoryId: 3, name: "Auto", color: "#abc", total: 30 },
      ],
    );

    expect(result).toEqual([
      { categoryId: 2, name: "Material", color: "#000", income: 50, expense: 200, total: 250 },
      { categoryId: 1, name: "Beratung", color: "#fff", income: 150, expense: 0, total: 150 },
      { categoryId: 3, name: "Auto", color: "#abc", income: 0, expense: 30, total: 30 },
    ]);
  });

  it("returns an empty array when there is no income or expense data", () => {
    expect(combineCategoryAmounts([], [])).toEqual([]);
  });
});
