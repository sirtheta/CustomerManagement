import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase } from "../test-utils";
import { appendAuditEntry, verifyAuditChain, GENESIS_HASH } from "@/lib/audit-chain";
import { logAudit, logAuditEntry } from "@/lib/audit";

const entry = (n: number) => ({
  userId: 1,
  userName: "Admin",
  action: "CREATE",
  entityType: "Customer",
  entityId: n,
  entityRef: `K-${n}`,
  details: null,
});

describe("audit hash chain", () => {
  const db = createTestDatabase();

  it("verifies an empty table", async () => {
    expect(await verifyAuditChain(db.prisma)).toEqual({ ok: true, checked: 0, legacy: 0, head: null });
  });

  it("starts at GENESIS and links each entry to its predecessor", async () => {
    const a = await appendAuditEntry(db.prisma, entry(1));
    const b = await appendAuditEntry(db.prisma, entry(2));
    const rows = await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(rows[0].prevHash).toBe(GENESIS_HASH);
    expect(rows[0].hash).toBe(a.hash);
    expect(rows[1].prevHash).toBe(a.hash);
    expect(rows[1].hash).toBe(b.hash);
    expect(await verifyAuditChain(db.prisma)).toEqual({ ok: true, checked: 2, legacy: 0, head: b.hash });
  });

  it("skips legacy rows without hash and chains after them", async () => {
    await db.prisma.auditLog.create({
      data: { userId: 1, userName: "Alt", action: "CREATE", entityType: "Customer" },
    });
    const a = await appendAuditEntry(db.prisma, entry(1));
    const rows = await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(rows[1].prevHash).toBe(GENESIS_HASH);
    expect(await verifyAuditChain(db.prisma)).toEqual({ ok: true, checked: 1, legacy: 1, head: a.hash });
  });

  it("detects an edited field", async () => {
    await appendAuditEntry(db.prisma, entry(1));
    const b = await appendAuditEntry(db.prisma, entry(2));
    await appendAuditEntry(db.prisma, entry(3));
    await db.prisma.auditLog.update({ where: { id: b.id }, data: { entityRef: "gefälscht" } });
    expect(await verifyAuditChain(db.prisma)).toMatchObject({
      ok: false, brokenAtId: b.id, reason: "hash-mismatch",
    });
  });

  it("detects a deleted middle entry", async () => {
    await appendAuditEntry(db.prisma, entry(1));
    const b = await appendAuditEntry(db.prisma, entry(2));
    const c = await appendAuditEntry(db.prisma, entry(3));
    await db.prisma.auditLog.delete({ where: { id: b.id } });
    expect(await verifyAuditChain(db.prisma)).toMatchObject({
      ok: false, brokenAtId: c.id, reason: "prev-mismatch",
    });
  });

  it("detects a row without hash after the chain started", async () => {
    await appendAuditEntry(db.prisma, entry(1));
    const injected = await db.prisma.auditLog.create({
      data: { userId: 1, userName: "X", action: "DELETE", entityType: "Invoice" },
    });
    expect(await verifyAuditChain(db.prisma)).toMatchObject({
      ok: false, brokenAtId: injected.id, reason: "missing-hash",
    });
  });

  it("keeps the chain linear under concurrent appends", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendAuditEntry(db.prisma, entry(i))));
    const result = await verifyAuditChain(db.prisma);
    expect(result).toMatchObject({ ok: true, checked: 10 });
    const prevs = (await db.prisma.auditLog.findMany()).map((r) => r.prevHash);
    expect(new Set(prevs).size).toBe(10);
  });

  it("verifies more rows than one batch", async () => {
    for (let i = 0; i < 520; i++) await appendAuditEntry(db.prisma, entry(i));
    expect(await verifyAuditChain(db.prisma)).toMatchObject({ ok: true, checked: 520 });
  }, 60_000);
});

describe("logAudit / logAuditEntry write chained rows", () => {
  const db = createTestDatabase();
  const session = { user: { id: "7", name: "Editor", email: "e@x.ch" } } as unknown as Session;

  it("logAudit chains its entries", async () => {
    await logAudit(session, "CREATE", "Customer", 1, "K-1", { a: 1 }, db.prisma);
    await logAudit(session, "UPDATE", "Customer", 1, "K-1", undefined, db.prisma);
    const rows = await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(rows.every((r) => r.hash && r.prevHash)).toBe(true);
    expect(await verifyAuditChain(db.prisma)).toMatchObject({ ok: true, checked: 2 });
  });

  it("logAuditEntry works without a session", async () => {
    await logAuditEntry(
      { userId: 3, userName: "Anon", action: "UPDATE", entityType: "User", entityId: 3, entityRef: "a@b.ch" },
      db.prisma
    );
    expect(await verifyAuditChain(db.prisma)).toMatchObject({ ok: true, checked: 1 });
  });

  it("never throws when the write fails", async () => {
    const broken = { $transaction: () => Promise.reject(new Error("db down")) } as never;
    await expect(logAudit(session, "CREATE", "Customer", 1, "K-1", undefined, broken)).resolves.toBeUndefined();
  });
});
