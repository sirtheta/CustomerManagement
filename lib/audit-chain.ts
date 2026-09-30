import { createHash } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

// Deliberately no "use server": plain helpers, never a public Server Action.

export const GENESIS_HASH = "GENESIS";
const MAX_APPEND_ATTEMPTS = 5;
const VERIFY_BATCH = 500;

export type AuditEntryInput = {
  userId: number;
  userName: string;
  action: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string | null;
  details?: string | null;
};

type HashFields = {
  prevHash: string;
  userId: number;
  userName: string;
  action: string;
  entityType: string;
  entityId: number | null;
  entityRef: string | null;
  details: string | null;
  createdAt: Date;
};

/** SHA-256 (hex) over a fixed-order JSON array, so field boundaries are unambiguous. */
export function computeAuditHash(f: HashFields): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        f.prevHash,
        f.userId,
        f.userName,
        f.action,
        f.entityType,
        f.entityId,
        f.entityRef,
        f.details,
        f.createdAt.toISOString(),
      ])
    )
    .digest("hex");
}

function isUniqueCollision(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Appends one entry to the chain. Reads the current head and inserts inside
 * a transaction; the unique index on prevHash makes two writers that read the
 * same head collide, and the loser retries against the new head.
 */
export async function appendAuditEntry(
  client: PrismaClient,
  entry: AuditEntryInput,
  nowOverride?: Date
): Promise<{ id: number; hash: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.$transaction(async (tx) => {
        const head = await tx.auditLog.findFirst({
          where: { hash: { not: null } },
          orderBy: { id: "desc" },
          select: { hash: true },
        });
        const prevHash = head?.hash ?? GENESIS_HASH;
        const fields = {
          userId: entry.userId,
          userName: entry.userName,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          entityRef: entry.entityRef ?? null,
          details: entry.details ?? null,
        };
        const now = nowOverride ?? new Date();
        const hash = computeAuditHash({ ...fields, prevHash, createdAt: now });
        const row = await tx.auditLog.create({
          data: { ...fields, createdAt: now, prevHash, hash },
          select: { id: true },
        });
        return { id: row.id, hash };
      });
    } catch (err) {
      if (!isUniqueCollision(err) || attempt >= MAX_APPEND_ATTEMPTS) throw err;
    }
  }
}

export type ChainVerification =
  | { ok: true; checked: number; legacy: number; head: string | null }
  | {
      ok: false;
      checked: number;
      legacy: number;
      brokenAtId: number;
      reason: "missing-hash" | "prev-mismatch" | "hash-mismatch";
    };

/**
 * Walks the whole table in id order. Rows without a hash before the first
 * chained row are pre-chain history ("legacy") and skipped; from the first
 * chained row on, every row must link to and hash-match its predecessor.
 */
export async function verifyAuditChain(client: PrismaClient): Promise<ChainVerification> {
  let cursor = 0;
  let checked = 0;
  let legacy = 0;
  let prev: string | null = null; // hash of previous chained row
  let chained = false;

  for (;;) {
    const rows = await client.auditLog.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: VERIFY_BATCH,
    });
    if (rows.length === 0) break;

    for (const r of rows) {
      cursor = r.id;
      if (r.hash === null) {
        if (chained) return { ok: false, checked, legacy, brokenAtId: r.id, reason: "missing-hash" };
        legacy++;
        continue;
      }
      chained = true;
      const expectedPrev = prev ?? GENESIS_HASH;
      if (r.prevHash !== expectedPrev) {
        return { ok: false, checked, legacy, brokenAtId: r.id, reason: "prev-mismatch" };
      }
      const recomputed = computeAuditHash({
        prevHash: expectedPrev,
        userId: r.userId,
        userName: r.userName,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        entityRef: r.entityRef,
        details: r.details,
        createdAt: r.createdAt,
      });
      if (recomputed !== r.hash) {
        return { ok: false, checked, legacy, brokenAtId: r.id, reason: "hash-mismatch" };
      }
      prev = r.hash;
      checked++;
    }
  }
  return { ok: true, checked, legacy, head: prev };
}
