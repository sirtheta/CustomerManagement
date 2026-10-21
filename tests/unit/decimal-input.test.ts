import { describe, it, expect } from "vitest";
import { parseDecimalInput } from "@/lib/decimal-input";

describe("parseDecimalInput", () => {
  it.each([
    ["85,50", 85.5],
    ["85.50", 85.5],
    ["85", 85],
    ["0,05", 0.05],
    ["1'250.50", 1250.5],
    [" 12,5 ", 12.5],
  ])("parses %s", (raw, expected) => {
    expect(parseDecimalInput(raw)).toBe(expected);
  });

  it.each(["", "abc", "1.250,50", "1,2,3", "-5", "8 5,5x", "85,"])("rejects %j", (raw) => {
    expect(parseDecimalInput(raw)).toBeNaN();
  });

  it("rejects null and undefined", () => {
    expect(parseDecimalInput(null)).toBeNaN();
    expect(parseDecimalInput(undefined)).toBeNaN();
  });
});
