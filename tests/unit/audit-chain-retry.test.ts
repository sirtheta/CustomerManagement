import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { appendAuditEntry } from "@/lib/audit-chain";

const entry = { userId: 1, userName: "A", action: "CREATE", entityType: "Customer" };
const collision = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

describe("appendAuditEntry retry", () => {
  it("retries after a unique collision and returns the second result", async () => {
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(collision())
      .mockResolvedValueOnce({ id: 2, hash: "h2" });
    const result = await appendAuditEntry({ $transaction } as unknown as PrismaClient, entry);
    expect(result).toEqual({ id: 2, hash: "h2" });
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("gives up after 5 attempts and rethrows", async () => {
    const $transaction = vi.fn().mockRejectedValue(collision());
    await expect(appendAuditEntry({ $transaction } as unknown as PrismaClient, entry)).rejects.toThrow(/Unique/);
    expect($transaction).toHaveBeenCalledTimes(5);
  });

  it("does not retry other errors", async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(appendAuditEntry({ $transaction } as unknown as PrismaClient, entry)).rejects.toThrow("boom");
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
