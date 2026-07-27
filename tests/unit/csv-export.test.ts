import { describe, it, expect } from "vitest";
import { buildCsv } from "@/lib/csv-export";

describe("buildCsv", () => {
  it("produces header + rows", () => {
    const csv = buildCsv(["Name", "Betrag"], [["Hans", "100.00"]]);
    expect(csv).toBe("Name,Betrag\nHans,100.00");
  });

  it("escapes cells containing commas", () => {
    const csv = buildCsv(["Name"], [['Müller, Hans']]);
    expect(csv).toContain('"Müller, Hans"');
  });

  it("escapes cells containing double quotes", () => {
    const csv = buildCsv(["Note"], [['"quoted"']]);
    expect(csv).toContain('"""quoted"""');
  });

  it("escapes cells containing newlines", () => {
    const csv = buildCsv(["Note"], [["line1\nline2"]]);
    expect(csv).toContain('"line1\nline2"');
  });

  it("returns header only for empty rows", () => {
    const csv = buildCsv(["A", "B"], []);
    expect(csv).toBe("A,B");
  });

  it("converts null/undefined to empty string", () => {
    const csv = buildCsv(["A"], [[null]]);
    expect(csv).toBe("A\n");
  });
});
