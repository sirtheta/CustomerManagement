import { describe, it, expect } from "vitest";
import { isCommonPassword, validatePasswordPolicy, MIN_PASSWORD_LENGTH } from "@/lib/password";

describe("isCommonPassword", () => {
  it("flags well-known breached passwords regardless of case", () => {
    expect(isCommonPassword("123456")).toBe(true);
    expect(isCommonPassword("PaSsWoRd")).toBe(true);
  });

  it("does not flag an unlikely passphrase", () => {
    expect(isCommonPassword("correct-horse-battery-staple-xyzzy-42")).toBe(false);
  });
});

describe("validatePasswordPolicy", () => {
  it("accepts a password of sufficient length that isn't breached", () => {
    expect(validatePasswordPolicy("correct-horse-battery-staple-xyzzy-42")).toBeNull();
  });

  it("rejects a password shorter than the minimum", () => {
    expect(validatePasswordPolicy("short")).toBe(
      `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`
    );
  });

  it("rejects a password that appears in the common-passwords list", () => {
    expect(validatePasswordPolicy("password123")).toBe(
      "Dieses Passwort kommt in Listen bekannter Datenlecks vor und ist zu unsicher."
    );
  });
});
