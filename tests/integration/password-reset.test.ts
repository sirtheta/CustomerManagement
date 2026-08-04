import { describe, it, expect } from "vitest";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  hashResetToken,
} from "@/lib/password-reset";
import { createTestDatabase } from "../test-utils";

describe("password-reset", () => {
  const db = createTestDatabase();

  async function createTestUser() {
    const { prisma } = db;
    return prisma.user.create({
      data: {
        email: "reset@test.ch",
        name: "Reset User",
        passwordHash: "irrelevant-for-these-tests",
        role: "Viewer",
      },
    });
  }

  it("stores only the hash of the raw token", async () => {
    const { prisma } = db;
    const user = await createTestUser();

    const token = await createPasswordResetToken(prisma, user.id);

    const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).toBe(hashResetToken(token));
    expect(row!.tokenHash).not.toBe(token);
  });

  it("replaces any previous token so only one stays valid", async () => {
    const { prisma } = db;
    const user = await createTestUser();

    await createPasswordResetToken(prisma, user.id);
    await createPasswordResetToken(prisma, user.id);

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("consumes a valid token exactly once", async () => {
    const { prisma } = db;
    const user = await createTestUser();
    const token = await createPasswordResetToken(prisma, user.id);

    const first = await consumePasswordResetToken(prisma, token);
    expect(first).toBe(user.id);

    const second = await consumePasswordResetToken(prisma, token);
    expect(second).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const { prisma } = db;
    const result = await consumePasswordResetToken(prisma, "does-not-exist");
    expect(result).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { prisma } = db;
    const user = await createTestUser();
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const token = await createPasswordResetToken(prisma, user.id, issuedAt);

    const oneHourAndOneSecondLater = new Date(issuedAt.getTime() + 60 * 60 * 1000 + 1000);
    const result = await consumePasswordResetToken(prisma, token, oneHourAndOneSecondLater);
    expect(result).toBeNull();
  });
});
