import { describe, it, expect } from "vitest";
import { z } from "zod";

// Swiss IBAN: CH + 2 check digits + 5-digit bank code + 12-digit account number
// with optional spaces every 4 characters.
const ibanSchema = z
  .string()
  .regex(
    /^CH\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{1}$/,
    "Invalid Swiss IBAN"
  );

describe("IBAN validation", () => {
  // Equivalent: SaveSettings_WithInvalidIBAN_ShouldThrowValidationException (Theory)
  it.each([
    [""],
    [null],
    ["test"],
    ["CH123ABC"],
    ["DE89370400440532013000"], // valid German IBAN – not Swiss
    ["CH123456789012345678901"], // too long
  ])("should reject invalid IBAN: '%s'", (iban) => {
    const result = ibanSchema.safeParse(iban ?? "");
    expect(result.success).toBe(false);
  });

  // Equivalent: SaveSettings_WithValidIBAN_ShouldNotThrow (Theory)
  it.each([
    ["CH9300762011623852957"],          // without spaces
    ["CH93 0076 2011 6238 5295 7"],    // with spaces
  ])("should accept valid Swiss IBAN: '%s'", (iban) => {
    const result = ibanSchema.safeParse(iban);
    expect(result.success).toBe(true);
  });
});
