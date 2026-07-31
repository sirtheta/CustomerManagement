import { describe, it, expect } from "vitest";
import { hash, compare } from "bcryptjs";
import {
  isCommonPassword,
  validatePasswordPolicy,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from "@/lib/password";

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

  it("accepts a password exactly at the byte limit", () => {
    expect(validatePasswordPolicy("a".repeat(MAX_PASSWORD_BYTES))).toBeNull();
  });

  it("rejects a password past the byte limit", () => {
    expect(validatePasswordPolicy("a".repeat(MAX_PASSWORD_BYTES + 1))).toBe(
      `Passwort darf höchstens ${MAX_PASSWORD_BYTES} Bytes lang sein (Umlaute zählen doppelt).`
    );
  });

  it("counts umlauts as the two bytes bcrypt sees, not one character", () => {
    // 36 × "ä" is 36 characters but 72 bytes — right at the limit.
    expect(validatePasswordPolicy("ä".repeat(36))).toBeNull();
    expect(validatePasswordPolicy("ä".repeat(37))).not.toBeNull();
  });

  it("guards against the truncation that makes the limit necessary", async () => {
    // Demonstrates why the bound exists: bcrypt ignores everything past 72
    // bytes, so these two passphrases would otherwise share a hash and either
    // one would open the account.
    const base = "a".repeat(MAX_PASSWORD_BYTES);
    const hashed = await hash(`${base}erster-zusatz`, 4);

    expect(await compare(`${base}zweiter-zusatz`, hashed)).toBe(true);
    expect(validatePasswordPolicy(`${base}erster-zusatz`)).not.toBeNull();
  });

  it("rejects a password that appears in the common-passwords list", () => {
    expect(validatePasswordPolicy("password123")).toBe(
      "Dieses Passwort kommt in Listen bekannter Datenlecks vor und ist zu unsicher."
    );
  });
});
