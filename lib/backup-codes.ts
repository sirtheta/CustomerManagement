import { randomInt } from "crypto";
import { OTP } from "otplib";
import { hashSync, compareSync } from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
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
  | { valid: true; consumedIndex: null; timeStep: number } // TOTP matched
  | { valid: true; consumedIndex: number } // backup code matched
  | { valid: false };

export function verifyTotpOrBackup(
  input: string,
  secret: string,
  hashedBackupCodes: string[],
  lastStep?: number | null
): VerifyResult {
  try {
    // otplib throws TokenLengthError for non-6-digit tokens (e.g. backup codes).
    // afterTimeStep rejects a code from an already used (or older) time step.
    const result = otp.verifySync({
      token: input,
      secret,
      ...(typeof lastStep === "number" ? { afterTimeStep: lastStep } : {}),
    });
    if (result.valid && "timeStep" in result) {
      return { valid: true, consumedIndex: null, timeStep: result.timeStep };
    }
  } catch {
    // Not 6-digit format — fall through to backup code check
  }

  const idx = matchBackupCode(hashedBackupCodes, input);
  if (idx === -1) return { valid: false };
  return { valid: true, consumedIndex: idx };
}

/**
 * Marks a TOTP time step as used. Conditional update, so of two concurrent
 * logins presenting the same code only one wins (a code is valid for a whole
 * time step and would otherwise be replayable within it).
 */
export async function claimTotpStep(
  prisma: Pick<PrismaClient, "user">,
  userId: number,
  timeStep: number
): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ totpLastStep: null }, { totpLastStep: { lt: timeStep } }],
    },
    data: { totpLastStep: timeStep },
  });
  return count === 1;
}
