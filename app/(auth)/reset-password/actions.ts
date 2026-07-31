"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { validatePasswordPolicy } from "@/lib/password";
import { isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { consumePasswordResetToken } from "@/lib/password-reset";

const log = logger.child({ module: "password-reset" });

export async function resetPasswordAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (!token) return { error: "Ungültige Eingabe." };
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { error: policyError };
  if (password !== passwordConfirm) {
    return { error: "Die Passwörter stimmen nicht überein." };
  }

  // Throttle token guessing. Tokens are 32 random bytes, so this is belt and
  // braces either way. Per IP where the address is trustworthy; otherwise a
  // single generous bucket that only counts *failures*, so a flood of wrong
  // tokens can't lock out someone following a real link from their inbox.
  const ip = clientIp(await headers());
  const bucket = ip === null ? "pwreset-consume:global" : `pwreset-consume:${ip}`;
  const maxAttempts = ip === null ? 100 : 10;
  if (isRateLimited(bucket, { maxAttempts })) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const userId = await consumePasswordResetToken(prisma, token);
  if (userId === null) {
    recordFailedAttempt(bucket, { maxAttempts });
    return { error: "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an." };
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hash(password, config.bcrypt.rounds),
      sessionEpoch: { increment: 1 },
    },
  });
  log.info({ userId }, "password reset completed");

  // No session exists here (anonymous request) — write the AuditLog row
  // directly, same never-throw contract as lib/audit.ts's logAudit.
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        userName: user.name,
        action: "UPDATE",
        entityType: "User",
        entityId: userId,
        entityRef: user.email,
        details: JSON.stringify({ action: "password-reset-self-service" }),
      },
    });
  } catch (err) {
    log.error({ err, userId }, "Failed to write audit log for password reset");
  }

  return { success: true };
}
