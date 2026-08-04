import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/password", () => ({ validatePasswordPolicy: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(), recordFailedAttempt: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({ clientIp: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/password-reset", () => ({ consumePasswordResetToken: vi.fn() }));
vi.mock("bcryptjs", () => ({ hash: vi.fn() }));

import { resetPasswordAction } from "@/app/(auth)/reset-password/actions";
import prisma from "@/lib/prisma";
import { validatePasswordPolicy } from "@/lib/password";
import { isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { consumePasswordResetToken } from "@/lib/password-reset";
import { hash } from "bcryptjs";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("resetPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRateLimited).mockReturnValue(false);
    vi.mocked(validatePasswordPolicy).mockReturnValue(null);
  });

  it("rejects a missing token", async () => {
    const result = await resetPasswordAction(
      undefined,
      form({ token: "", password: "Sicher!123", passwordConfirm: "Sicher!123" })
    );
    expect(result.error).toBeDefined();
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("returns the password policy error", async () => {
    vi.mocked(validatePasswordPolicy).mockReturnValue("Zu kurz.");
    const result = await resetPasswordAction(
      undefined,
      form({ token: "tok", password: "short", passwordConfirm: "short" })
    );
    expect(result.error).toBe("Zu kurz.");
  });

  it("rejects mismatched password confirmation", async () => {
    const result = await resetPasswordAction(
      undefined,
      form({ token: "tok", password: "Sicher!123", passwordConfirm: "Anders!123" })
    );
    expect(result.error).toBe("Die Passwörter stimmen nicht überein.");
  });

  it("rejects once rate-limited", async () => {
    vi.mocked(isRateLimited).mockReturnValue(true);
    const result = await resetPasswordAction(
      undefined,
      form({ token: "tok", password: "Sicher!123", passwordConfirm: "Sicher!123" })
    );
    expect(result.error).toContain("Zu viele Versuche");
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("records a failed attempt and returns an error for an invalid token", async () => {
    vi.mocked(consumePasswordResetToken).mockResolvedValue(null);
    const result = await resetPasswordAction(
      undefined,
      form({ token: "bad", password: "Sicher!123", passwordConfirm: "Sicher!123" })
    );
    expect(result.error).toContain("ungültig oder abgelaufen");
    expect(recordFailedAttempt).toHaveBeenCalled();
  });

  it("resets the password, bumps sessionEpoch, and writes an audit log on success", async () => {
    vi.mocked(consumePasswordResetToken).mockResolvedValue(42);
    vi.mocked(hash).mockResolvedValue("$2b$10$newhash" as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 42,
      name: "Reset User",
      email: "reset@test.ch",
    } as never);

    const result = await resetPasswordAction(
      undefined,
      form({ token: "good", password: "Sicher!123", passwordConfirm: "Sicher!123" })
    );

    expect(result.success).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { passwordHash: "$2b$10$newhash", sessionEpoch: { increment: 1 } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 42, entityType: "User", action: "UPDATE" }),
      })
    );
  });
});
