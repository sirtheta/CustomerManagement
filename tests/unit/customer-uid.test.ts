import { describe, it, expect } from "vitest";
import { normalizeUid, isValidUid } from "@/lib/customer-uid";

describe("normalizeUid", () => {
  it("formats loose input", () => {
    expect(normalizeUid("che116281710")).toBe("CHE-116.281.710");
    expect(normalizeUid(" CHE-116.281.710 ")).toBe("CHE-116.281.710");
    expect(normalizeUid("CHE-116.281.710 MWST")).toBe("CHE-116.281.710");
    expect(normalizeUid("CHE116.281.710 TVA")).toBe("CHE-116.281.710");
  });

  it("returns null for anything that is not a UID", () => {
    expect(normalizeUid("")).toBeNull();
    expect(normalizeUid("CHE-12.345.678")).toBeNull();
    expect(normalizeUid("ABC-116.281.710")).toBeNull();
    expect(normalizeUid("CHE-116.281.71X")).toBeNull();
  });
});

describe("isValidUid", () => {
  it("accepts UIDs with a correct check digit", () => {
    expect(isValidUid("CHE-116.281.710")).toBe(true);
    expect(isValidUid("CHE-100.000.006")).toBe(true);
    expect(isValidUid("CHE116281710MWST")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidUid("CHE-116.281.711")).toBe(false);
    expect(isValidUid("CHE-100.000.007")).toBe(false);
  });

  it("rejects UIDs whose check digit would be 10", () => {
    // 11100000: weighted sum 12 -> remainder 1 -> check digit 10, which no UID can carry
    for (let last = 0; last <= 9; last++) {
      expect(isValidUid(`CHE-111.000.00${last}`)).toBe(false);
    }
  });

  it("rejects malformed input", () => {
    expect(isValidUid("")).toBe(false);
    expect(isValidUid("CHE-123")).toBe(false);
  });
});
