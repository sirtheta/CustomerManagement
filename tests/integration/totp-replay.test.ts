import { describe, it, expect } from "vitest";
import { claimTotpStep } from "@/lib/backup-codes";
import { createTestDatabase } from "../test-utils";

describe("claimTotpStep", () => {
  const db = createTestDatabase();

  async function createUser() {
    return db.prisma.user.create({
      data: { email: "totp@test.ch", name: "Totp", passwordHash: "x", role: "Viewer" },
    });
  }

  it("accepts a time step exactly once", async () => {
    const user = await createUser();
    expect(await claimTotpStep(db.prisma, user.id, 5000)).toBe(true);
    expect(await claimTotpStep(db.prisma, user.id, 5000)).toBe(false);
  });

  it("rejects an older step after a newer one was used", async () => {
    const user = await createUser();
    expect(await claimTotpStep(db.prisma, user.id, 5001)).toBe(true);
    expect(await claimTotpStep(db.prisma, user.id, 5000)).toBe(false);
  });

  it("lets only one of two concurrent logins claim the same step", async () => {
    const user = await createUser();
    const results = await Promise.all([
      claimTotpStep(db.prisma, user.id, 7000),
      claimTotpStep(db.prisma, user.id, 7000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("stores the claimed step on the user", async () => {
    const user = await createUser();
    await claimTotpStep(db.prisma, user.id, 6000);
    const row = await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpLastStep).toBe(6000);
  });
});
