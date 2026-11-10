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

  // Excel evaluates a leading "+" as a formula (+41-79-123-45-67 shows -273,
  // +41791234567 becomes 4.18E+10), so phone numbers get the apostrophe too.
  // Fidelity for non-spreadsheet consumers deliberately ranks behind that.
  it.each(["+41 79 123 45 67", "+41791234567", "+41-79-123-45-67", "+41 (0)79 123 45 67"])(
    "neutralizes the phone number %j",
    (value) => {
      expect(cell(value)).toBe(`'${value}`);
    }
  );

  it("leaves plain numbers, including negative amounts, untouched", () => {
    expect(cell("-100.00")).toBe("-100.00");
    expect(cell("5")).toBe("5");
    expect(cell("-5")).toBe("-5");
    expect(cell(-12.5)).toBe("-12.5");
  });

  // Swiss-German Excel splits on ";": an unquoted "Foo;=HYPERLINK(...)" would
  // open as two cells, the second one a live formula.
  it("quotes cells containing the semicolon list separator", () => {
    expect(cell("Foo;=1+1")).toBe('"Foo;=1+1"');
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
