import { describe, it, expect } from "vitest";
import { parseDate, toDateString, addDays } from "@/lib/date";

describe("parseDate", () => {
  it("parses YYYY-MM-DD into a local-time date", () => {
    const d = parseDate("2026-06-13")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(13);
    expect(d.getHours()).toBe(0);
  });

  it("returns undefined for empty/invalid input", () => {
    expect(parseDate("")).toBeUndefined();
    expect(parseDate(undefined)).toBeUndefined();
    expect(parseDate("not-a-date")).toBeUndefined();
  });
});

describe("toDateString", () => {
  it("formats a date using its local calendar day", () => {
    expect(toDateString(new Date(2026, 5, 13))).toBe("2026-06-13");
  });

  it("zero-pads month and day", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("round-trip", () => {
  it("toDateString(parseDate(x)) === x", () => {
    for (const s of ["2026-06-13", "2026-01-01", "2026-12-31", "2024-02-29"]) {
      expect(toDateString(parseDate(s)!)).toBe(s);
    }
  });

  it("survives the spring DST boundary without shifting the day", () => {
    // CET → CEST transition is the last Sunday of March; no UTC round-trip means no off-by-one.
    expect(toDateString(parseDate("2026-03-29")!)).toBe("2026-03-29");
  });
});

describe("addDays", () => {
  it("adds days and returns a YYYY-MM-DD string", () => {
    expect(addDays("2026-06-13", 30)).toBe("2026-07-13");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("returns the input unchanged when it is not parseable", () => {
    expect(addDays("", 30)).toBe("");
  });
});
