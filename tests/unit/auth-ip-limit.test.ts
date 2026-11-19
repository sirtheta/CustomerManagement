import { describe, it, expect, vi, beforeEach } from "vitest";

// Same harness as auth-authorize.test.ts, but with the REAL rate limiter and
// client-ip helper, so the limit itself (not just its wiring) is exercised.
const state = vi.hoisted(() => ({
  authorize: null as ((creds: unknown, request?: unknown) => Promise<unknown>) | null,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: Record<string, unknown>) => {
    state.authorize = config.authorize as (creds: unknown, request?: unknown) => Promise<unknown>;
    return config;
  },
}));
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
  CredentialsSignin: class extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("bcryptjs", () => ({ compare: vi.fn() }));
vi.mock("@/lib/backup-codes", () => ({ verifyTotpOrBackup: vi.fn(), claimTotpStep: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn((v: string) => v) }));
vi.mock("@/lib/password", () => ({ dummyCompare: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ warn: () => {}, info: () => {}, error: () => {} }) },
}));

import "@/lib/auth";
import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";

const user = {
  id: 1,
  email: "user@test.ch",
  name: "Test",
  passwordHash: "hash",
  role: "Editor",
  isActive: true,
  totpEnabled: false,
  totpSecret: null,
  totpBackupCodes: null,
};

let n = 0;
let ip: string;
function request(forwardedFor: string) {
  return new Request("https://example.test/login", { headers: { "x-forwarded-for": forwardedFor } });
}
function attempt(email: string, password = "wrong", from = ip) {
  return state.authorize!({ email, password }, request(from));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRUST_PROXY_HEADERS = "1";
  // Unique address per test: the limiter's store is module-level.
  ip = `198.51.100.${++n}`;
  vi.mocked(prisma.user.findUnique).mockImplementation((async ({ where }: { where: { email: string } }) =>
    where.email.startsWith("known") ? { ...user, email: where.email } : null) as never);
  vi.mocked(compare).mockResolvedValue(false as never);
});

describe("login: per-IP limit with the real rate limiter", () => {
  it("blocks the 21st failed attempt from one IP across different accounts, even with a correct password", async () => {
    for (let i = 0; i < 20; i++) await attempt(`known${i}@test.ch`);
    vi.mocked(prisma.user.findUnique).mockClear();
    vi.mocked(compare).mockResolvedValue(true as never);

    expect(await attempt("known99@test.ch", "correct")).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("does not block other IPs", async () => {
    for (let i = 0; i < 20; i++) await attempt(`known${i}@test.ch`);
    vi.mocked(compare).mockResolvedValue(true as never);
    expect(await attempt("known1@test.ch", "correct", `203.0.113.${n}`)).not.toBeNull();
  });

  it("cannot be outrun by concurrent requests", async () => {
    // compare() yields to the event loop, like bcrypt does in production.
    vi.mocked(compare).mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, 5));
      return false;
    }) as never);

    await Promise.all(Array.from({ length: 60 }, (_, i) => attempt(`known${i}@test.ch`)));
    expect(vi.mocked(compare)).toHaveBeenCalledTimes(20);
  });

  it("successful logins do not use up the budget", async () => {
    vi.mocked(compare).mockResolvedValue(true as never);
    for (let i = 0; i < 40; i++) {
      expect(await attempt(`known${i}@test.ch`, "correct")).not.toBeNull();
    }
  });

  it("successes in between do not refund earlier failures", async () => {
    for (let i = 0; i < 10; i++) await attempt(`known${i}@test.ch`);
    vi.mocked(compare).mockResolvedValue(true as never);
    for (let i = 0; i < 30; i++) await attempt(`known${i}@test.ch`, "correct");
    vi.mocked(compare).mockResolvedValue(false as never);
    for (let i = 0; i < 10; i++) await attempt(`known${i + 10}@test.ch`);
    vi.mocked(compare).mockClear();
    await attempt("known50@test.ch");
    expect(compare).not.toHaveBeenCalled();
  });

  it("an attacker-controlled left part of x-forwarded-for does not pick the bucket", async () => {
    for (let i = 0; i < 20; i++) await attempt(`known${i}@test.ch`, "wrong", `10.${i}.0.1, ${ip}`);
    vi.mocked(prisma.user.findUnique).mockClear();
    await attempt("known77@test.ch", "wrong", `10.99.0.1, ${ip}`);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("treats a whole IPv6 /64 as one bucket", async () => {
    const prefix = `2001:db8:${n}:1`;
    for (let i = 0; i < 20; i++) await attempt(`known${i}@test.ch`, "wrong", `${prefix}::${i + 1}`);
    vi.mocked(prisma.user.findUnique).mockClear();
    await attempt("known77@test.ch", "wrong", `${prefix}:abcd::1`);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("applies no IP limit when TRUST_PROXY_HEADERS is unset", async () => {
    delete process.env.TRUST_PROXY_HEADERS;
    for (let i = 0; i < 30; i++) await attempt(`known${i}@test.ch`);
    expect(vi.mocked(compare)).toHaveBeenCalledTimes(30);
  });
});
