import { describe, it, expect, afterEach } from "vitest";
import { parseDate, toDateString, addDays, swissDateString, swissToday } from "@/lib/date";

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

describe("swissDateString / swissToday", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each([
    // 00:30 on 1 January in Zurich (CET, UTC+1) is still 31 December in UTC.
    ["2025-12-31T23:30:00Z", "2026-01-01"],
    ["2025-12-31T22:59:59Z", "2025-12-31"],
    ["2026-01-01T00:30:00Z", "2026-01-01"],
    // Summer time (CEST, UTC+2).
    ["2026-06-30T22:30:00Z", "2026-07-01"],
    ["2026-06-30T21:59:59Z", "2026-06-30"],
    // Day of the spring DST switch.
    ["2026-03-28T23:30:00Z", "2026-03-29"],
  ])("maps the instant %s to the Swiss day %s", (instant, day) => {
    expect(swissDateString(new Date(instant))).toBe(day);
    expect(swissToday(new Date(instant)).toISOString()).toBe(`${day}T00:00:00.000Z`);
  });

  it.each(["UTC", "Europe/Zurich", "America/New_York"])("does not depend on the server time zone (TZ=%s)", (tz) => {
    process.env.TZ = tz;
    expect(swissDateString(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(swissToday(new Date("2025-12-31T23:30:00Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
