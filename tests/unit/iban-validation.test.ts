import { describe, it, expect } from "vitest";
import { validateIban } from "@/lib/iban";

describe("validateIban", () => {
  it.each([
    ["CH9300762011623852957"],
    ["CH93 0076 2011 6238 5295 7"],
    ["ch9300762011623852957"],
    ["  CH93 0076 2011 6238 5295 7  "],
    ["LI21088100002324013AA"],
  ])("accepts valid CH/LI IBAN: '%s'", (input) => {
    const result = validateIban(input);
    expect(result.valid).toBe(true);
  });

  it("returns the normalized IBAN without spaces in upper case", () => {
    expect(validateIban("ch93 0076 2011 6238 5295 7")).toEqual({
      valid: true,
      iban: "CH9300762011623852957",
    });
  });

  it.each([
    ["test"],
    ["CH123ABC"],
    ["CH123456789012345678901"], // right length, wrong check digits
    ["CH9300762011623852958"], // one digit off: checksum mismatch
    ["CH93007620116238529571"], // too long
    ["CH930076201162385295"], // too short
    ["DE89370400440532013000"], // valid IBAN, but not CH/LI
    ["CH93-0076-2011-6238-5295-7"], // illegal characters
  ])("rejects invalid IBAN: '%s'", (input) => {
    const result = validateIban(input);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBeTruthy();
  });
});
