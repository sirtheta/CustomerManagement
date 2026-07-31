import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({ clientIp: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/password-reset", () => ({ createPasswordResetToken: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAccountMail: vi.fn() }));
vi.mock("@/lib/origin", () => ({ appOrigin: vi.fn().mockResolvedValue("http://localhost:3000") }));

import { requestPasswordResetAction } from "@/app/(auth)/forgot-password/actions";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendAccountMail } from "@/lib/email";

function form(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(true);
  });

  it("rejects an invalid email without touching the database", async () => {
    const result = await requestPasswordResetAction(undefined, form("not-an-email"));
    expect(result.error).toBeDefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("answers generically when the account does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await requestPasswordResetAction(undefined, form("nobody@test.ch"));
    expect(result.success).toBe(true);
    expect(createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("answers generically when the account is inactive", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      email: "inactive@test.ch",
      isActive: false,
    } as never);
    const result = await requestPasswordResetAction(undefined, form("inactive@test.ch"));
    expect(result.success).toBe(true);
    expect(createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("sends a reset email for an active account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 1,
      email: "active@test.ch",
      name: "Active",
      isActive: true,
    } as never);
    vi.mocked(createPasswordResetToken).mockResolvedValue("raw-token");
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
      companyInfo: {},
    } as never);

    const result = await requestPasswordResetAction(undefined, form("active@test.ch"));
    expect(result.success).toBe(true);
    expect(sendAccountMail).toHaveBeenCalled();
  });

  it("answers generically (without querying the user) once rate-limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const result = await requestPasswordResetAction(undefined, form("someone@test.ch"));
    expect(result.success).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
