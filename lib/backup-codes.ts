import { randomInt } from "crypto";
import { OTP } from "otplib";
import { hashSync, compareSync } from "bcryptjs";
import { config } from "@/lib/config";

const otp = new OTP({ strategy: "totp" });

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_FORMAT = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const part = (n: number) =>
      Array.from({ length: n }, () => CHARS[randomInt(CHARS.length)]).join("");
    return `${part(4)}-${part(4)}`;
  });
}

/** Hashes plaintext backup codes for storage — codes are shown once, then only verified. */
export function hashBackupCodes(codes: string[]): string[] {
  return codes.map((c) => hashSync(c, config.bcrypt.rounds));
}

/** Matches user input against stored bcrypt hashes of backup codes. */
export function matchBackupCode(hashedCodes: string[], input: string): number {
  const normalized = input.toUpperCase();
  // Skip the expensive bcrypt compares for inputs that can't be a backup code
  if (!CODE_FORMAT.test(normalized)) return -1;
  return hashedCodes.findIndex((hash) => compareSync(normalized, hash));
}

export type VerifyResult =
  | { valid: true; consumedIndex: null }   // TOTP matched
  | { valid: true; consumedIndex: number } // backup code matched
  | { valid: false };

export function verifyTotpOrBackup(
  input: string,
  secret: string,
  hashedBackupCodes: string[]
): VerifyResult {
  try {
    // otplib throws TokenLengthError for non-6-digit tokens (e.g. backup codes)
    const result = otp.verifySync({ token: input, secret });
    if (result.valid) return { valid: true, consumedIndex: null };
  } catch {
    // Not 6-digit format — fall through to backup code check
  }

  const idx = matchBackupCode(hashedBackupCodes, input);
  if (idx === -1) return { valid: false };
  return { valid: true, consumedIndex: idx };
}
