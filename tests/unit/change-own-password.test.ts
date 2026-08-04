import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue("$2b$10$newhash"),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  resetRateLimit: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import { changeOwnPassword } from "@/app/(app)/profile/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { compare } from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

const session = {
  user: { id: "1", name: "Test User", email: "user@example.com", role: "Editor" },
} as never;

const user = {
  id: 1,
  email: "user@example.com",
  passwordHash: "$2b$10$currenthash",
  isActive: true,
};

function form(current: string, next: string, confirm = next): FormData {
  const fd = new FormData();
  fd.set("currentPassword", current);
  fd.set("newPassword", next);
  fd.set("confirmPassword", confirm);
  return fd;
}

describe("changeOwnPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(session);
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await changeOwnPassword({}, form("old", "new-test-pw-9x7q"));
    expect(result.error).toBe("Nicht angemeldet.");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const result = await changeOwnPassword({}, form("old-password", "short"));
    expect(result.error).toBe("Passwort muss mindestens 8 Zeichen haben.");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects when confirmation does not match", async () => {
    const result = await changeOwnPassword({}, form("old-password", "new-test-pw-9x7q", "different"));
    expect(result.error).toBe("Die Passwörter stimmen nicht überein.");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects when rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const result = await changeOwnPassword({}, form("old-password", "new-test-pw-9x7q"));
    expect(result.error).toBe("Zu viele Versuche. Bitte später erneut versuchen.");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password", async () => {
    vi.mocked(compare).mockResolvedValue(false as never);
    const result = await changeOwnPassword({}, form("wrong", "new-test-pw-9x7q"));
    expect(result.error).toBe("Aktuelles Passwort ist falsch.");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("updates the hash and writes an audit log on success", async () => {
    vi.mocked(compare).mockResolvedValue(true as never);
    const result = await changeOwnPassword({}, form("old-password", "new-test-pw-9x7q"));
    expect(result.success).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { passwordHash: "$2b$10$newhash" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      session, "UPDATE", "User", 1, "user@example.com", { action: "password-changed" }
    );
  });

  it("never stores the plaintext password", async () => {
    vi.mocked(compare).mockResolvedValue(true as never);
    await changeOwnPassword({}, form("old-password", "new-test-pw-9x7q"));
    const updateArg = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(JSON.stringify(updateArg)).not.toContain("new-test-pw-9x7q");
  });
});
