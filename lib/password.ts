import { compare, hash } from "bcryptjs";
import { config } from "@/lib/config";

/** Minimum length for any user-set password, enforced server-side. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Single source of truth for the password policy. Returns a German error
 * message when the password is unacceptable, or null when it passes.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`;
  }
  return null;
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Performs a bcrypt comparison against a dummy hash. Called on login paths
 * where the user does not exist, so the response time matches the real
 * password check and does not reveal whether an email is registered.
 */
export async function dummyCompare(password: string): Promise<void> {
  dummyHashPromise ??= hash("timing-equalization-dummy-password", config.bcrypt.rounds);
  await compare(password, await dummyHashPromise);
}
