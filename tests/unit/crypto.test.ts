import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("my-smtp-password");
    expect(encrypted).not.toBe("my-smtp-password");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptSecret(encrypted)).toBe("my-smtp-password");
  });

  it("round-trips unicode and special characters", () => {
    const secret = "pässwörd:with/special&chars 🤖";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("does not double-encrypt an already encrypted value", () => {
    const once = encryptSecret("secret");
    expect(encryptSecret(once)).toBe(once);
  });

  it("passes empty strings through unchanged", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("passes legacy plaintext through decryptSecret unchanged", () => {
    expect(decryptSecret("legacy-plaintext-password")).toBe("legacy-plaintext-password");
  });

  it("returns empty string for tampered ciphertext instead of throwing", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(":");
    // flip the ciphertext portion
    parts[parts.length - 1] = Buffer.from("tampered!").toString("base64");
    expect(decryptSecret(parts.join(":"))).toBe("");
  });

  it("isEncrypted distinguishes encrypted from plaintext values", () => {
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("plaintext")).toBe(false);
  });
});
