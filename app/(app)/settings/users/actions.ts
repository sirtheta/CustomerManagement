"use server";

import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { OTP } from "otplib";
import { UserRole } from "@prisma/client";
import QRCode from "qrcode";
import type { ActionState } from "@/hooks/use-action-toast";
import { generateBackupCodes, hashBackupCodes } from "@/lib/backup-codes";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { config } from "@/lib/config";
import { logAudit } from "@/lib/audit";
import { validatePasswordPolicy } from "@/lib/password";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendAccountMail } from "@/lib/email";
import { appOrigin } from "@/lib/origin";
import logger from "@/lib/logger";

const log = logger.child({ module: "settings.users" });
const otp = new OTP({ strategy: "totp" });

export type UserFormState = { error?: string; success?: boolean; _ts?: number };

const USER_MUTATIONS_DISABLED = process.env.DISABLE_USER_MUTATIONS === 'true';
const USER_MUTATIONS_DISABLED_MSG = "Benutzerverwaltung ist in der Testumgebung deaktiviert.";

/**
 * Sends the "set your password" link a freshly created (or re-invited) user
 * needs, since they have no password of their own yet. Reuses the same
 * reset-token/reset-password machinery as self-service forgot-password, so
 * there is only one place that issues and consumes these links.
 */
async function sendInviteEmail(userId: number, name: string, email: string): Promise<void> {
  const token = await createPasswordResetToken(prisma, userId);
  const link = `${await appOrigin()}/reset-password?token=${token}`;
  const settings = await prisma.applicationSettings.findFirst({ include: { companyInfo: true } });
  if (!settings) throw new Error("SMTP nicht konfiguriert (keine Einstellungen).");
  await sendAccountMail(
    settings,
    email,
    "Konto erstellt",
    `Hallo ${name}\n\n` +
      `Für dich wurde ein Konto angelegt. Über folgenden Link kannst du dein Passwort setzen (gültig für 1 Stunde):\n` +
      `${link}\n\n` +
      `Falls dir das nicht bekannt vorkommt, wende dich an den Administrator.`
  );
}

export async function createUser(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const email = (formData.get("email") as string)?.trim();
  const name = (formData.get("name") as string)?.trim();
  const password = formData.get("password") as string;
  const role = formData.get("role") as UserRole;

  if (!email || !name || !role) {
    return { error: "Alle Felder sind Pflicht." };
  }
  if (password) {
    const policyError = validatePasswordPolicy(password);
    if (policyError) return { error: policyError };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "E-Mail bereits vergeben." };

  // No password given: the user logs in via the invite link instead, so the
  // stored hash only needs to be unguessable, never entered by anyone.
  const plaintext = password || randomBytes(32).toString("hex");
  const passwordHash = await hash(plaintext, config.bcrypt.rounds);
  const user = await prisma.user.create({ data: { email, name, passwordHash, role } });
  await logAudit(session, "CREATE", "User", user.id, email, { name, role });

  if (!password) {
    try {
      await sendInviteEmail(user.id, user.name, user.email);
    } catch (err) {
      // The account exists either way; the admin can resend the invite from
      // the row menu, same as a broken audit write never blocks the
      // underlying mutation (see logAudit).
      log.error({ err, userId: user.id }, "Failed to send account invite email");
    }
  }

  revalidatePath("/settings/users");
  return {};
}

async function guardLastAdmin(userId: number, newRole?: UserRole, newIsActive?: boolean, isDeleting = false): Promise<string | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.role !== UserRole.Admin || !user.isActive) return null;

  const wouldLoseAdmin = isDeleting || (newRole !== undefined && newRole !== UserRole.Admin);
  const wouldDeactivate = newIsActive !== undefined && !newIsActive;
  if (!wouldLoseAdmin && !wouldDeactivate) return null;

  const otherActiveAdmins = await prisma.user.count({
    where: { role: UserRole.Admin, isActive: true, id: { not: userId } },
  });
  if (otherActiveAdmins === 0) {
    return "Aktion nicht möglich: Es muss mindestens ein aktiver Admin vorhanden sein.";
  }
  return null;
}

export async function updateUser(
  id: number,
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const name = (formData.get("name") as string)?.trim();
  const role = formData.get("role") as UserRole;
  const isActive = formData.get("isActive") === "true";

  if (!name || !role) return { error: "Name und Rolle sind Pflicht." };

  const guardError = await guardLastAdmin(id, role, isActive);
  if (guardError) return { error: guardError };

  const user = await prisma.user.update({ where: { id }, data: { name, role, isActive } });
  await logAudit(session, "UPDATE", "User", id, user.email, { name, role, isActive });
  revalidatePath("/settings/users");
  return {};
}

export async function resetPassword(
  id: number,
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const password = formData.get("password") as string;
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { error: policyError };
  const passwordHash = await hash(password, config.bcrypt.rounds);
  // An admin-set password revokes that user's existing sessions and any
  // invite/reset link still sitting in their inbox — same reasoning as a
  // self-service reset (see User.sessionEpoch).
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash, sessionEpoch: { increment: 1 } },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId: id } });
  await logAudit(session, "UPDATE", "User", id, user.email, { action: "password-reset" });
  revalidatePath("/settings/users");
  return { success: true, _ts: Date.now() };
}

export async function deleteUser(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const guardError = await guardLastAdmin(id, undefined, undefined, true);
  if (guardError) return { error: guardError };
  const user = await prisma.user.delete({ where: { id } });
  await logAudit(session, "DELETE", "User", id, user.email);
  revalidatePath("/settings/users");
  return {};
}

export async function generateTotpSetup(
  userId: number
): Promise<{ secret: string; qrCodeDataUrl: string; otpauthUrl: string } | { error: string }> {
  await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const secret = otp.generateSecret();
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(user.email)}?secret=${secret}&issuer=CustomerManagement`;
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  // Store the pending secret temporarily in the user record (not yet enabled)
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret), totpEnabled: false },
  });
  return { secret, qrCodeDataUrl, otpauthUrl };
}

export async function confirmTotpSetup(
  userId: number,
  token: string
): Promise<ActionState & { backupCodes?: string[] }> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpSecret) return { error: "Kein TOTP-Setup gefunden." };
  const result = otp.verifySync({ token, secret: decryptSecret(user.totpSecret) });
  if (!result.valid) return { error: "Falscher Code. Bitte erneut versuchen." };
  const backupCodes = generateBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: true, totpBackupCodes: JSON.stringify(hashBackupCodes(backupCodes)) },
  });
  await logAudit(session, "UPDATE", "User", userId, user.email, { action: "totp-enabled" });
  revalidatePath("/settings/users");
  return { success: true, _ts: Date.now(), backupCodes };
}

/**
 * (Re-)sends the "set your password" link to a user — for an invite that
 * bounced, or any time an admin wants to hand password control back to the
 * user instead of typing one in themselves.
 */
export async function sendPasswordSetupEmail(userId: number): Promise<UserFormState> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  try {
    await sendInviteEmail(user.id, user.name, user.email);
  } catch (err) {
    log.error({ err, userId }, "Failed to send password setup email");
    return { error: "E-Mail konnte nicht gesendet werden. Bitte SMTP-Einstellungen prüfen." };
  }
  await logAudit(session, "UPDATE", "User", userId, user.email, { action: "password-setup-email-sent" });
  return { success: true, _ts: Date.now() };
}

export async function disableTotp(userId: number): Promise<{ error: string } | void> {
  const session = await requireAdmin();
  if (USER_MUTATIONS_DISABLED) return { error: USER_MUTATIONS_DISABLED_MSG };
  const user = await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null },
  });
  await logAudit(session, "UPDATE", "User", userId, user.email, { action: "totp-disabled" });
  revalidatePath("/settings/users");
}
