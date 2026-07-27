import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import { config } from "@/lib/config";

const log = logger.child({ module: "crypto" });

const PREFIX = "enc:v1:";
// Static application salt: the input (AUTH_SECRET) is itself high-entropy,
// the salt only prevents key reuse across applications.
const KEY_SALT = "customermanagement-secret-encryption-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // validateEnv() already enforces AUTH_SECRET in production at startup
      throw new Error("AUTH_SECRET must be set in production");
    }
    log.warn("AUTH_SECRET not set — using insecure development encryption key");
  }
  cachedKey = scryptSync(secret ?? "insecure-development-encryption-key", KEY_SALT, 32);
  return cachedKey;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a secret for storage at rest (AES-256-GCM, key derived from
 * AUTH_SECRET). Empty and already-encrypted values pass through unchanged.
 */
export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a stored secret. Values without the encryption prefix are returned
 * unchanged (legacy plaintext from before encryption-at-rest was introduced).
 * Returns "" when decryption fails (e.g. AUTH_SECRET changed) so callers
 * treat the secret as unset instead of using ciphertext as a credential.
 */
export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored;
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    log.error(
      { err },
      "Failed to decrypt stored secret — AUTH_SECRET may have changed; re-enter the secret in the settings"
    );
    return "";
  }
}

/**
 * One-time, idempotent startup migration: encrypts secrets that were stored
 * in plaintext before encryption-at-rest existed (SMTP password, Telegram
 * bot token, TOTP secrets) and hashes plaintext TOTP backup codes.
 */
export async function migrateSecretsAtRest(prisma: PrismaClient): Promise<void> {
  const { hashSync } = await import("bcryptjs");
  let migrated = 0;

  const settingsRows = await prisma.applicationSettings.findMany({
    select: { applicationSettingsId: true, smtpPassword: true, notifyTelegramBotToken: true },
  });
  for (const row of settingsRows) {
    const data: { smtpPassword?: string; notifyTelegramBotToken?: string } = {};
    if (row.smtpPassword && !isEncrypted(row.smtpPassword)) {
      data.smtpPassword = encryptSecret(row.smtpPassword);
    }
    if (row.notifyTelegramBotToken && !isEncrypted(row.notifyTelegramBotToken)) {
      data.notifyTelegramBotToken = encryptSecret(row.notifyTelegramBotToken);
    }
    if (Object.keys(data).length > 0) {
      await prisma.applicationSettings.update({
        where: { applicationSettingsId: row.applicationSettingsId },
        data,
      });
      migrated++;
    }
  }

  const users = await prisma.user.findMany({
    select: { id: true, totpSecret: true, totpBackupCodes: true },
  });
  for (const user of users) {
    const data: { totpSecret?: string; totpBackupCodes?: string } = {};
    if (user.totpSecret && !isEncrypted(user.totpSecret)) {
      data.totpSecret = encryptSecret(user.totpSecret);
    }
    if (user.totpBackupCodes) {
      const codes: string[] = JSON.parse(user.totpBackupCodes);
      // bcrypt hashes start with "$2"; plaintext codes are XXXX-XXXX
      if (codes.some((c) => !c.startsWith("$2"))) {
        data.totpBackupCodes = JSON.stringify(
          codes.map((c) => (c.startsWith("$2") ? c : hashSync(c, config.bcrypt.rounds)))
        );
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data });
      migrated++;
    }
  }

  if (migrated > 0) {
    log.info({ migrated }, "Migrated plaintext secrets to encrypted/hashed storage");
  }
}
