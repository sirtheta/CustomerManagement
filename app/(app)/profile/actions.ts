"use server";

import { compare, hash } from "bcryptjs";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { logAudit } from "@/lib/audit";
import { validatePasswordPolicy } from "@/lib/password";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/hooks/use-action-toast";

export async function changeOwnPassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session) return { error: "Nicht angemeldet." };

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "Alle Felder sind Pflicht." };
  }
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) return { error: policyError };
  if (newPassword !== confirmPassword) {
    return { error: "Die Passwörter stimmen nicht überein." };
  }

  const userId = parseInt(session.user.id, 10);
  const rateLimitKey = `pwchange:${userId}`;
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return { error: "Benutzer nicht gefunden." };

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) return { error: "Aktuelles Passwort ist falsch." };

  const passwordHash = await hash(newPassword, config.bcrypt.rounds);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  resetRateLimit(rateLimitKey);
  await logAudit(session, "UPDATE", "User", userId, user.email, { action: "password-changed" });
  return { success: true, _ts: Date.now() };
}
