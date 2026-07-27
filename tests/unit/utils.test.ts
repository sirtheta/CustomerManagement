import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate } from "@/lib/utils";

describe("formatCurrency", () => {
  it("formats a CHF amount with currency symbol and two decimal places", () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain("CHF");
    expect(result).toContain("1");
    expect(result).toContain("234.56");
  });

  it("formats zero as CHF 0.00", () => {
    const result = formatCurrency(0);
    expect(result).toContain("CHF");
    expect(result).toContain("0.00");
  });

  it("formats string input correctly", () => {
    const result = formatCurrency("99.9");
    expect(result).toContain("99.90");
  });

  it("uses the provided locale", () => {
    const result = formatCurrency(100, "de-CH");
    expect(result).toContain("100");
  });
});

describe("formatDate", () => {
  it("formats a date in de-CH locale (dd.mm.yyyy)", () => {
    const result = formatDate(new Date("2025-06-15"));
    expect(result).toBe("15.06.2025");
  });

  it("accepts string input", () => {
    const result = formatDate("2025-01-01");
    expect(result).toBe("01.01.2025");
  });
});
