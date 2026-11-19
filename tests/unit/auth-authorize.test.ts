import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the authorize function from the Credentials provider
const state = vi.hoisted(() => ({
  authorize: null as ((creds: unknown, request?: unknown) => Promise<unknown>) | null,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: Record<string, unknown>) => {
    state.authorize = config.authorize as (creds: unknown, request?: unknown) => Promise<unknown>;
    return config;
  },
}));
const { MockCredentialsSignin } = vi.hoisted(() => ({
  MockCredentialsSignin: class extends Error {
    type = "CredentialsSignin";
    code = "credentials";
  },
}));
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
  CredentialsSignin: MockCredentialsSignin,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("bcryptjs", () => ({ compare: vi.fn() }));
vi.mock("@/lib/backup-codes", () => ({ verifyTotpOrBackup: vi.fn(), claimTotpStep: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn((v: string) => v) }));
vi.mock("@/lib/password", () => ({ dummyCompare: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  refundAttempt: vi.fn(),
  resetRateLimit: vi.fn(),
}));
vi.mock("@/lib/client-ip", () => ({
  clientIp: vi.fn().mockReturnValue(null),
  ipBucket: (ip: string) => ip,
}));
vi.mock("@/lib/config", () => ({
  config: {
    session: { maxAgeSec: 28800, updateAgeSec: 3600 },
    bcrypt: { rounds: 10 },
    rateLimit: { maxAttempts: 5, windowMs: 900000 },
  },
}));
const logSpy = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ default: { child: () => logSpy } }));

// Import triggers NextAuth({...}) → state.authorize is set
import "@/lib/auth";
import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";
import { verifyTotpOrBackup, claimTotpStep } from "@/lib/backup-codes";
import { checkRateLimit, refundAttempt, resetRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { dummyCompare } from "@/lib/password";

const baseUser = {
  id: 1,
  email: "user@test.ch",
  name: "Test User",
  passwordHash: "$2b$10$hash",
  role: "Editor",
  isActive: true,
  totpEnabled: false,
  totpSecret: null,
  totpBackupCodes: null,
};

async function callAuthorize(creds: Record<string, string>, request?: unknown) {
  return state.authorize!(creds, request);
}

describe("auth.ts – authorize()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(clientIp).mockReturnValue(null);
  });

  it("returns null for invalid credentials (bad email format)", async () => {
    const result = await callAuthorize({ email: "not-an-email", password: "pw" });
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for empty password", async () => {
    const result = await callAuthorize({ email: "user@test.ch", password: "" });
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when rate limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const result = await callAuthorize({ email: "user@test.ch", password: "password" });
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when user is not found (with dummy compare)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await callAuthorize({ email: "unknown@test.ch", password: "pw" });
    expect(result).toBeNull();
    expect(dummyCompare).toHaveBeenCalled();
  });

  it("returns null when user is inactive", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      isActive: false,
    } as never);
    const result = await callAuthorize({ email: "user@test.ch", password: "pw" });
    expect(result).toBeNull();
    expect(dummyCompare).toHaveBeenCalled();
  });

  it("returns null when password is wrong", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(baseUser as never);
    vi.mocked(compare).mockResolvedValue(false as never);
    const result = await callAuthorize({ email: "user@test.ch", password: "wrong" });
    expect(result).toBeNull();
  });

  it("returns user object on correct password (no TOTP)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(baseUser as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    const result = await callAuthorize({ email: "user@test.ch", password: "correct" });
    expect(result).toEqual({
      id: "1",
      name: "Test User",
      email: "user@test.ch",
      role: "Editor",
    });
    expect(resetRateLimit).toHaveBeenCalled();
  });

  it("throws a totp_required error when TOTP is enabled but no code is provided", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    await expect(callAuthorize({ email: "user@test.ch", password: "correct" })).rejects.toMatchObject({
      code: "totp_required",
    });
  });

  it("throws a totp_invalid error when TOTP code is invalid", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: null,
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: false });
    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "000000" })
    ).rejects.toMatchObject({ code: "totp_invalid" });
  });

  it("returns user when TOTP code is valid", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: null,
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: null, timeStep: 4242 });
    vi.mocked(claimTotpStep).mockResolvedValue(true);
    const result = await callAuthorize({
      email: "user@test.ch",
      password: "correct",
      totpCode: "123456",
    });
    expect(result).toMatchObject({ email: "user@test.ch", role: "Editor" });
    expect(claimTotpStep).toHaveBeenCalledWith(prisma, baseUser.id, 4242);
    expect(resetRateLimit).toHaveBeenCalled();
  });

  it("passes the last used time step to verification", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: null,
      totpLastStep: 4241,
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: false });
    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "123456" })
    ).rejects.toMatchObject({ code: "totp_invalid" });
    expect(verifyTotpOrBackup).toHaveBeenCalledWith("123456", "encryptedsecret", [], 4241);
  });

  it("throws totp_invalid when the TOTP time step was already used (replay)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: null,
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: null, timeStep: 4242 });
    vi.mocked(claimTotpStep).mockResolvedValue(false);
    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "123456" })
    ).rejects.toMatchObject({ code: "totp_invalid" });
  });

  it("consumes backup code and returns user", async () => {
    const backupCodes = ["hash0", "hash1", "hash2"];
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: JSON.stringify(backupCodes),
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: 1 });
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never);

    // totpCode must be 6-9 chars to pass the loginSchema validation
    const result = await callAuthorize({
      email: "user@test.ch",
      password: "correct",
      totpCode: "BACKUP1",
    });
    expect(result).toMatchObject({ email: "user@test.ch" });
    // Consumed code at index 1 is removed; remaining are [hash0, hash2]
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: baseUser.id, totpBackupCodes: JSON.stringify(backupCodes) },
      data: { totpBackupCodes: JSON.stringify(["hash0", "hash2"]) },
    });
  });

  it("throws totp_invalid when backup code was concurrently consumed (count === 0)", async () => {
    const backupCodes = ["hash0", "hash1"];
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
      totpBackupCodes: JSON.stringify(backupCodes),
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: 0 });
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "BACKUP2" })
    ).rejects.toMatchObject({ code: "totp_invalid" });
  });
});

describe("auth.ts – authorize(): client IP", () => {
  const IP = "203.0.113.7";
  const IP_KEY = `login-ip:${IP}`;
  const IP_LIMIT = { maxAttempts: 20 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(true);
    vi.mocked(clientIp).mockReturnValue(IP);
  });

  it("passes the request headers to clientIp", async () => {
    const request = new Request("https://example.test/login", {
      headers: { "x-forwarded-for": IP },
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await callAuthorize({ email: "user@test.ch", password: "pw" }, request);
    expect(clientIp).toHaveBeenCalledWith(request.headers);
  });

  it("copes with a missing request object", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(callAuthorize({ email: "user@test.ch", password: "pw" })).resolves.toBeNull();
    expect(clientIp).toHaveBeenCalledWith(undefined);
  });

  it("refuses before any DB lookup when the IP is over its limit, without touching the account bucket", async () => {
    vi.mocked(checkRateLimit).mockImplementation((key) => !key.startsWith("login-ip:"));
    const result = await callAuthorize({ email: "user@test.ch", password: "pw" });
    expect(result).toBeNull();
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(IP_KEY, IP_LIMIT);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(refundAttempt).not.toHaveBeenCalled();
    expect(logSpy.warn).toHaveBeenCalledWith({ ip: IP }, "login blocked: ip rate limit exceeded");
  });

  it("counts the attempt up front and keeps it for a wrong password, logging the IP", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(baseUser as never);
    vi.mocked(compare).mockResolvedValue(false as never);
    await callAuthorize({ email: "user@test.ch", password: "wrong" });
    expect(checkRateLimit).toHaveBeenCalledWith(IP_KEY, IP_LIMIT);
    expect(refundAttempt).not.toHaveBeenCalled();
    expect(logSpy.warn).toHaveBeenCalledWith(
      { email: "user@test.ch", ip: IP },
      "login failed: wrong password"
    );
  });

  it("keeps the attempt for an unknown or inactive user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await callAuthorize({ email: "unknown@test.ch", password: "pw" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...baseUser, isActive: false } as never);
    await callAuthorize({ email: "user@test.ch", password: "pw" });
    expect(refundAttempt).not.toHaveBeenCalled();
  });

  it("refunds malformed input and a locked account (no credential was checked)", async () => {
    await callAuthorize({ email: "not-an-email", password: "pw" });
    expect(refundAttempt).toHaveBeenCalledWith(IP_KEY);

    vi.mocked(refundAttempt).mockClear();
    vi.mocked(checkRateLimit).mockImplementation((key) => key.startsWith("login-ip:"));
    await callAuthorize({ email: "user@test.ch", password: "pw" });
    expect(refundAttempt).toHaveBeenCalledWith(IP_KEY);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refunds a missing TOTP code but keeps an invalid one", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);

    await expect(callAuthorize({ email: "user@test.ch", password: "correct" })).rejects.toBeDefined();
    expect(refundAttempt).toHaveBeenCalledTimes(1);

    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: false } as never);
    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "000000" })
    ).rejects.toBeDefined();
    expect(refundAttempt).toHaveBeenCalledTimes(1);
  });

  it("keeps the attempt when a TOTP code was already used", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...baseUser,
      totpEnabled: true,
      totpSecret: "encryptedsecret",
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: null, timeStep: 1 } as never);
    vi.mocked(claimTotpStep).mockResolvedValue(false as never);
    await expect(
      callAuthorize({ email: "user@test.ch", password: "correct", totpCode: "123456" })
    ).rejects.toBeDefined();
    expect(refundAttempt).not.toHaveBeenCalled();
  });

  it("refunds on success and resets only the account bucket", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(baseUser as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    await callAuthorize({ email: "user@test.ch", password: "correct" });
    expect(refundAttempt).toHaveBeenCalledWith(IP_KEY);
    expect(resetRateLimit).toHaveBeenCalledTimes(1);
    expect(resetRateLimit).toHaveBeenCalledWith("login:user@test.ch");
    expect(logSpy.info).toHaveBeenCalledWith(
      { email: "user@test.ch", userId: 1, ip: IP },
      "login success"
    );
  });

  it("falls back to per-account limiting only when no trusted IP is available", async () => {
    vi.mocked(clientIp).mockReturnValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(baseUser as never);
    vi.mocked(compare).mockResolvedValue(false as never);
    await callAuthorize({ email: "user@test.ch", password: "wrong" });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith("login:user@test.ch");
    expect(refundAttempt).not.toHaveBeenCalled();
  });
});
