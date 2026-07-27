import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the authorize function from the Credentials provider
const state = vi.hoisted(() => ({ authorize: null as ((creds: unknown) => Promise<unknown>) | null }));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: Record<string, unknown>) => {
    state.authorize = config.authorize as (creds: unknown) => Promise<unknown>;
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
vi.mock("@/lib/backup-codes", () => ({ verifyTotpOrBackup: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn((v: string) => v) }));
vi.mock("@/lib/password", () => ({ dummyCompare: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  resetRateLimit: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  config: { session: { maxAgeSec: 28800, updateAgeSec: 3600 }, bcrypt: { rounds: 10 } },
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ warn: () => {}, info: () => {}, error: () => {} }) },
}));

// Import triggers NextAuth({...}) → state.authorize is set
import "@/lib/auth";
import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";
import { verifyTotpOrBackup } from "@/lib/backup-codes";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
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

async function callAuthorize(creds: Record<string, string>) {
  return state.authorize!(creds);
}

describe("auth.ts – authorize()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(true);
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
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: false, consumedIndex: null });
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
    vi.mocked(verifyTotpOrBackup).mockReturnValue({ valid: true, consumedIndex: null });
    const result = await callAuthorize({
      email: "user@test.ch",
      password: "correct",
      totpCode: "123456",
    });
    expect(result).toMatchObject({ email: "user@test.ch", role: "Editor" });
    expect(resetRateLimit).toHaveBeenCalled();
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
