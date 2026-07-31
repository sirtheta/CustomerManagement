import { readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { compare, hash } from "bcryptjs";
import { config } from "@/lib/config";

/** Minimum length for any user-set password, enforced server-side. */
export const MIN_PASSWORD_LENGTH = 8;

const COMMON_PASSWORDS_PATH = path.join(process.cwd(), "lib", "data", "common-passwords-100k.txt.gz");

let commonPasswords: Set<string> | null = null;

/**
 * Loaded once per process and kept in memory — the gzipped source is ~370KB,
 * decompressing it on every password check would be wasteful for a list that
 * never changes at runtime.
 */
function loadCommonPasswords(): Set<string> {
  if (!commonPasswords) {
    const raw = gunzipSync(readFileSync(COMMON_PASSWORDS_PATH)).toString("utf-8");
    commonPasswords = new Set(raw.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean));
  }
  return commonPasswords;
}

/**
 * Top 100k passwords from real-world breaches (SecLists' xato-net list).
 * Case-insensitive, since attackers try the obvious case variants for free.
 */
export function isCommonPassword(password: string): boolean {
  return loadCommonPasswords().has(password.toLowerCase());
}

/**
 * Single source of truth for the password policy. Returns a German error
 * message when the password is unacceptable, or null when it passes.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`;
  }
  if (isCommonPassword(password)) {
    return "Dieses Passwort kommt in Listen bekannter Datenlecks vor und ist zu unsicher.";
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
