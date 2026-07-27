import { describe, it, expect } from "vitest";
import { createTestDatabase } from "../test-utils";
import { migrateSecretsAtRest, isEncrypted, decryptSecret } from "@/lib/crypto";
import { hashBackupCodes } from "@/lib/backup-codes";

describe("migrateSecretsAtRest", () => {
  const db = createTestDatabase();

  async function seedSettings(smtpPassword: string | null, botToken: string | null) {
    const company = await db.prisma.companyInformation.create({ data: {} });
    return db.prisma.applicationSettings.create({
      data: {
        smtpPassword,
        notifyTelegramBotToken: botToken,
        companyInformationId: company.companyInformationId,
      },
    });
  }

  it("encrypts plaintext SMTP password and Telegram token", async () => {
    const settings = await seedSettings("plain-password", "plain-bot-token");

    await migrateSecretsAtRest(db.prisma);

    const after = await db.prisma.applicationSettings.findUniqueOrThrow({
      where: { applicationSettingsId: settings.applicationSettingsId },
    });
    expect(isEncrypted(after.smtpPassword!)).toBe(true);
    expect(decryptSecret(after.smtpPassword!)).toBe("plain-password");
    expect(isEncrypted(after.notifyTelegramBotToken!)).toBe(true);
    expect(decryptSecret(after.notifyTelegramBotToken!)).toBe("plain-bot-token");
  });

  it("is idempotent — second run leaves encrypted values unchanged", async () => {
    const settings = await seedSettings("plain-password", null);

    await migrateSecretsAtRest(db.prisma);
    const first = await db.prisma.applicationSettings.findUniqueOrThrow({
      where: { applicationSettingsId: settings.applicationSettingsId },
    });
    await migrateSecretsAtRest(db.prisma);
    const second = await db.prisma.applicationSettings.findUniqueOrThrow({
      where: { applicationSettingsId: settings.applicationSettingsId },
    });
    expect(second.smtpPassword).toBe(first.smtpPassword);
  });

  it("leaves null secrets untouched", async () => {
    const settings = await seedSettings(null, null);
    await migrateSecretsAtRest(db.prisma);
    const after = await db.prisma.applicationSettings.findUniqueOrThrow({
      where: { applicationSettingsId: settings.applicationSettingsId },
    });
    expect(after.smtpPassword).toBeNull();
    expect(after.notifyTelegramBotToken).toBeNull();
  });

  it("encrypts plaintext TOTP secrets and hashes plaintext backup codes", async () => {
    const user = await db.prisma.user.create({
      data: {
        email: "totp@example.com",
        name: "TOTP User",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
        totpEnabled: true,
        totpSecret: "JBSWY3DPEHPK3PXP",
        totpBackupCodes: JSON.stringify(["ABCD-EFGH", "JKLM-NPQR"]),
      },
    });

    await migrateSecretsAtRest(db.prisma);

    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isEncrypted(after.totpSecret!)).toBe(true);
    expect(decryptSecret(after.totpSecret!)).toBe("JBSWY3DPEHPK3PXP");
    const codes: string[] = JSON.parse(after.totpBackupCodes!);
    expect(codes).toHaveLength(2);
    for (const code of codes) expect(code).toMatch(/^\$2/);
  });

  it("leaves already-hashed backup codes unchanged", async () => {
    const hashed = hashBackupCodes(["ABCD-EFGH"]);
    const user = await db.prisma.user.create({
      data: {
        email: "hashed@example.com",
        name: "Hashed User",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
        totpBackupCodes: JSON.stringify(hashed),
      },
    });

    await migrateSecretsAtRest(db.prisma);

    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(JSON.parse(after.totpBackupCodes!)).toEqual(hashed);
  });
});
