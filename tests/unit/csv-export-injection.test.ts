import { describe, it, expect } from "vitest";
import { buildCsv, csvResponse } from "@/lib/csv-export";

// A cell is read as a formula by Excel/LibreOffice when it starts with one of
// = + - @ (or a tab/CR). Imported customer or invoice text ends up in exports
// the accountant opens in a spreadsheet, so those cells get a leading apostrophe.

const cell = (v: unknown) => buildCsv(["A"], [[v]]).split("\n")[1];

describe("buildCsv – formula injection", () => {
  it.each([
    '=HYPERLINK("http://evil","x")',
    "=1+1",
    "+cmd|' /C calc'!A0",
    "-2+3",
    "@SUM(A1)",
    "\t=1+1",
    "\r=1+1",
  ])("neutralizes %j with a leading apostrophe", (value) => {
    expect(cell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("keeps CSV quoting around the neutralized value", () => {
    expect(cell("=1+1,2")).toBe(`"'=1+1,2"`);
    expect(cell('=A"B')).toBe(`"'=A""B"`);
  });

  // International phone numbers start with "+". A value made only of digits and
  // phone separators cannot hold a function, cell reference or DDE command (all
  // need letters or | ! = " '), so it stays readable instead of getting an apostrophe.
  it.each(["+41 79 123 45 67", "+41 (0)79 123 45 67", "+41-79-123.45.67", "+41/79/1234567"])(
    "leaves the phone number %j untouched",
    (value) => {
      expect(cell(value)).toBe(value);
    }
  );

  it.each(["+cmd|' /C calc'!A0", "+1+1", "+SUM(1,2)", "+41 79 =1", "+41\n=1", "+A1"])(
    "still neutralizes the plus-prefixed non-phone value %j",
    (value) => {
      expect(cell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    }
  );

  it("leaves plain numbers, including negative amounts, untouched", () => {
    expect(cell("-100.00")).toBe("-100.00");
    expect(cell("+5")).toBe("+5");
    expect(cell("-5")).toBe("-5");
    expect(cell(-12.5)).toBe("-12.5");
  });

  it("leaves ordinary text untouched", () => {
    expect(cell("Hans Müller")).toBe("Hans Müller");
    expect(cell("a=b")).toBe("a=b");
  });

  it("neutralizes header cells as well", () => {
    expect(buildCsv(["=evil()"], []).startsWith("'=evil()")).toBe(true);
  });
});

describe("csvResponse", () => {
  it("is not cacheable by shared caches or browsers", () => {
    expect(csvResponse("a", "x.csv").headers.get("Cache-Control")).toBe("private, no-store");
  });
});
