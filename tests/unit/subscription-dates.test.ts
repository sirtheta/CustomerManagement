import { describe, it, expect } from "vitest";
import { addInterval, advancePast, skippedPeriods, INTERVAL_LABELS } from "@/lib/subscription-dates";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("addInterval", () => {
  it("adds one month", () => {
    expect(addInterval(d(2026, 3, 15), "Monthly")).toEqual(d(2026, 4, 15));
  });
  it("adds three months across a year boundary", () => {
    expect(addInterval(d(2026, 11, 10), "Quarterly")).toEqual(d(2027, 2, 10));
  });
  it("adds twelve months", () => {
    expect(addInterval(d(2026, 6, 1), "Yearly")).toEqual(d(2027, 6, 1));
  });
  it("clamps to the end of a shorter month", () => {
    expect(addInterval(d(2026, 1, 31), "Monthly")).toEqual(d(2026, 2, 28));
    expect(addInterval(d(2027, 1, 31), "Monthly")).toEqual(d(2027, 2, 28));
    expect(addInterval(d(2028, 1, 31), "Monthly")).toEqual(d(2028, 2, 29));
  });
  it("moves 29 Feb to 28 Feb in a non-leap year", () => {
    expect(addInterval(d(2028, 2, 29), "Yearly")).toEqual(d(2029, 2, 28));
  });
  it("does not mutate its input", () => {
    const input = d(2026, 3, 15);
    addInterval(input, "Monthly");
    expect(input).toEqual(d(2026, 3, 15));
  });
});

describe("advancePast", () => {
  it("advances once when the result is already in the future", () => {
    expect(advancePast(d(2026, 9, 29), "Monthly", d(2026, 9, 30))).toEqual(d(2026, 10, 29));
  });
  it("catches up after downtime so that only one invoice is due", () => {
    expect(advancePast(d(2026, 1, 15), "Monthly", d(2026, 9, 30))).toEqual(d(2026, 10, 15));
  });
  it("never returns a date <= today", () => {
    const today = d(2026, 10, 15);
    expect(advancePast(d(2026, 9, 15), "Monthly", today).getTime()).toBeGreaterThan(today.getTime());
  });
});

describe("skippedPeriods", () => {
  it("is 0 when only the current period is due", () => {
    expect(skippedPeriods(d(2026, 9, 29), "Monthly", d(2026, 9, 30))).toBe(0);
    expect(skippedPeriods(d(2026, 9, 30), "Monthly", d(2026, 9, 30))).toBe(0);
  });
  it("counts every due period after the first", () => {
    expect(skippedPeriods(d(2026, 1, 15), "Monthly", d(2026, 9, 30))).toBe(8);
    expect(skippedPeriods(d(2025, 10, 1), "Quarterly", d(2026, 10, 2))).toBe(4);
  });
  it("matches the number of steps advancePast takes beyond the first", () => {
    const today = d(2026, 10, 2);
    const next = advancePast(d(2026, 1, 31), "Monthly", today);
    expect(skippedPeriods(d(2026, 1, 31), "Monthly", today)).toBe(8);
    expect(next).toEqual(d(2026, 10, 28));
  });
});

describe("INTERVAL_LABELS", () => {
  it("has a German label per interval", () => {
    expect(INTERVAL_LABELS).toEqual({ Monthly: "Monatlich", Quarterly: "Quartalsweise", Yearly: "Jährlich" });
  });
});
