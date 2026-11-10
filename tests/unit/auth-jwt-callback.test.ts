import { describe, it, expect, vi, beforeEach } from "vitest";

type JwtCb = (args: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown> | null>;
const state = vi.hoisted(() => ({ jwt: null as JwtCb | null }));

vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }));
vi.mock("next-auth", () => ({
  default: (config: { callbacks: { jwt: JwtCb } }) => {
    state.jwt = config.callbacks.jwt;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: class extends Error {},
}));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn() } } }));
vi.mock("bcryptjs", () => ({ compare: vi.fn() }));
vi.mock("@/lib/backup-codes", () => ({ verifyTotpOrBackup: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn() }));
vi.mock("@/lib/password", () => ({ dummyCompare: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(), resetRateLimit: vi.fn() }));
vi.mock("@/lib/config", () => ({
  config: { session: { maxAgeSec: 28800, updateAgeSec: 3600 }, bcrypt: { rounds: 10 } },
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ warn: () => {}, info: () => {}, error: () => {} }) },
}));

import "@/lib/auth";
import prisma from "@/lib/prisma";

describe("auth.ts – jwt callback session revocation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a token whose epoch matches the stored epoch", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sessionEpoch: 3 } as never);
    const token = { id: "1", role: "Admin", sessionEpoch: 3 };
    expect(await state.jwt!({ token })).toEqual(token);
  });

  it("rejects a token issued before the epoch was bumped", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sessionEpoch: 4 } as never);
    expect(await state.jwt!({ token: { id: "1", role: "Admin", sessionEpoch: 3 } })).toBeNull();
  });

  it("rejects a token whose user no longer exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await state.jwt!({ token: { id: "1", sessionEpoch: 0 } })).toBeNull();
  });
});
