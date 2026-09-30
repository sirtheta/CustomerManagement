# F4 Teil B: Hash-Kette im Audit-Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder neue `AuditLog`-Eintrag enthält den SHA-256-Hash seines Vorgängers, sodass nachträgliches Ändern oder Löschen einzelner Einträge erkennbar wird; die Admin-Seite „Aktivitätsprotokoll“ zeigt den Prüfstatus.

**Architecture:** `AuditLog` bekommt zwei nullable Spalten `prevHash` (unique) und `hash`. Neue Datei `lib/audit-chain.ts` kapselt Hash-Berechnung, Anhängen (Transaktion + Retry bei Kollision) und Prüfung. `logAudit` und der anonyme Schreibpfad im Passwort-Reset gehen beide durch dieselbe Funktion. Alte Einträge (ohne Hash) bleiben unangetastet; die Kette beginnt mit dem ersten neuen Eintrag.

**Tech Stack:** Prisma 7 + SQLite (better-sqlite3-Adapter), Node `crypto`, Vitest, Next.js 16 Server Components.

**Spec:** Es gibt kein eigenes Design-Dokument. Grundlage ist der F4-Eintrag in `FEATURE_ANALYSE.md` („Das Audit-Log bekommt eine Hash-Kette (jeder Eintrag enthält den Hash des vorherigen)“) und U6. Die Design-Entscheidungen stehen im nächsten Abschnitt. Format und Stil wie `docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md`.

## Global Constraints

- UI-Texte, Fehlermeldungen und Dokumentation sind **auf Deutsch**; Commit-Messages **auf Englisch** im Conventional-Commits-Format (`feat(audit): …`).
- `logAudit` darf die Hauptoperation nie unterbrechen (never-throw-Vertrag bleibt; Fehler werden über `log.error` geloggt).
- Additive Migration, kein Umschreiben bestehender Zeilen. Produktion wendet Migrationen über `scripts/startup.js` an (kein Prisma-CLI im Image); Tests bauen das Schema per `prisma db push` (`tests/test-utils.ts`).
- Kein `"use server"` in `lib/audit-chain.ts` (reine Helfer, nie als öffentliche Server Action exponieren).
- Vor Änderungen an `public/benutzerhandbuch.html`: Datei enthält base64-Bilder, **nie komplett lesen**, nur mit `grep -n` und `Edit` gezielt ändern.
- Nicht Teil dieses Plans (YAGNI): externe Zeitstempel/WORM (offene Frage 8 in `FEATURE_ANALYSE.md`), nächtlicher Prüf-Cron, Nachhashen der Altbestände, Export der Kette.

## Design-Entscheidungen

- **Felder im Hash:** `prevHash`, `userId`, `userName`, `action`, `entityType`, `entityId`, `entityRef`, `details`, `createdAt` (ISO-String mit Millisekunden), kanonisch als `JSON.stringify([...])` eines Arrays fester Reihenfolge, dann SHA-256 als Hex (64 Zeichen). `createdAt` wird im Code gesetzt (nicht vom DB-Default), damit der gespeicherte Wert exakt dem gehashten entspricht.
- **Genesis:** Der erste verkettete Eintrag hat `prevHash = "GENESIS"` (nicht `null`). Grund: `prevHash` ist `@unique`, und SQLite erlaubt mehrere `NULL` in einem Unique-Index. Mit `null` könnten zwei gleichzeitige erste Einträge beide als Kettenanfang durchgehen. Altzeilen behalten `prevHash = null` und `hash = null`.
- **Linearität:** `@@unique` auf `prevHash` erzwingt, dass jeder Hash höchstens einen Nachfolger hat. Zwei parallele Schreiber, die denselben Vorgänger lesen, kollidieren (`P2002`); der Verlierer wiederholt in einer neuen Transaktion (max. 5 Versuche), Der `P2002`-Check prüft bewusst nur den Fehlercode: Mit dem Driver-Adapter fehlt `err.meta.target` (die Prüfung `isDocumentNumberCollision` in `lib/document-number.ts` ist deshalb kein Vorbild). Hinweis: Der better-sqlite3-Adapter sperrt interaktive Transaktionen im selben Prozess mit einem Mutex, Kollisionen sind daher in der Praxis selten; der Retry ist ein Sicherheitsnetz (z. B. für mehrere Prozesse) und wird per Fake-Client getestet.
- **Prüfung** (`verifyAuditChain`): Zeilen nach `id` aufsteigend, in Blöcken. Zeilen mit `hash = null` vor dem ersten verketteten Eintrag sind „Altbestand“ und werden übersprungen. Danach gilt: fehlender Hash, falscher `prevHash` (Lücke/Löschung/Umordnung) oder falsch berechneter Hash ist ein Bruch; Ergebnis nennt die `id` der ersten kaputten Zeile.
- **Bekannte Grenzen (ehrlich benennen):** Der Hash ist unverschlüsselt (SHA-256 über bekannte Felder). Wer Schreibzugriff auf die SQLite-Datei hat, kann eine Zeile ändern **und** alle folgenden Hashes neu berechnen; die Prüfung meldet dann „ok“. Erkannt werden also Änderungen und Löschungen ohne Neuberechnung der Kette. Das Abschneiden der letzten Einträge ist ebenfalls nur erkennbar, wenn ein früher notierter Kopf-Hash extern aufbewahrt wurde. Deshalb zeigt die Admin-Seite den aktuellen Kopf-Hash an und bietet die Prüfung `?head=<hash>` („kommt dieser früher notierte Hash noch in der Kette vor?“). Wer mehr braucht (HMAC mit Secret ausserhalb der DB, externe Zeitstempel), macht das später (offene Frage 8).
- **Zeitstempel:** `createdAt` wird pro Versuch innerhalb der Transaktion gesetzt (nicht davor), damit Kettenreihenfolge (`id`) und Zeitreihenfolge zusammenpassen.
- **Aufrufregel:** `logAudit`/`logAuditEntry` nie innerhalb eines `$transaction`-Callbacks aufrufen (die innere Transaktion wartet auf den Mutex der äusseren; nach ca. 2 s `P2028`, Eintrag geht verloren). Heute gibt es keinen solchen Aufruf.

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma` (ändern) | `AuditLog.prevHash`, `AuditLog.hash` |
| `prisma/migrations/<ts>_audit_hash_chain/migration.sql` (neu) | Spalten + Unique-Index |
| `lib/audit-chain.ts` (neu) | `computeAuditHash`, `appendAuditEntry`, `verifyAuditChain`, Typen, `GENESIS_HASH` |
| `lib/audit.ts` (ändern) | `logAudit` nutzt `appendAuditEntry`; neu: `logAuditEntry` (never-throw, ohne Session) |
| `app/(auth)/reset-password/actions.ts` (ändern) | anonymer Schreibpfad über `logAuditEntry` |
| `app/(app)/settings/audit/page.tsx` (ändern) | Prüfstatus-Banner mit Kopf-Hash |
| `tests/unit/audit-chain-hash.test.ts` (neu) | Hash-Funktion rein |
| `tests/unit/audit-chain-retry.test.ts` (neu) | Retry bei P2002 mit Fake-Client |
| `tests/integration/audit-chain.test.ts` (neu) | Anhängen, Prüfen, Manipulation, Linearität |
| `tests/integration/audit-chain-migration.test.ts` (neu) | Migration lässt Altzeilen unverändert |
| `tests/unit/reset-password-actions.test.ts` (ändern) | Mock auf `logAuditEntry` umstellen |
| `CLAUDE.md`, `public/benutzerhandbuch.html`, `FEATURE_ANALYSE.md` (ändern) | Doku |

---

### Task 1: Schema und Migration

**Files:**
- Modify: `prisma/schema.prisma` (Modell `AuditLog`, ca. Zeile 282)
- Create: `prisma/migrations/<timestamp>_audit_hash_chain/migration.sql` (per `prisma migrate dev` erzeugen)
- Test: `tests/integration/audit-chain-migration.test.ts`

**Interfaces:**
- Consumes: —
- Produces: Prisma-Felder `AuditLog.prevHash: string | null` (unique), `AuditLog.hash: string | null`.

- [ ] **Step 1: Schema ändern**

In `prisma/schema.prisma` das Modell `AuditLog` ersetzen durch:

```prisma
model AuditLog {
  id         Int      @id @default(autoincrement())
  userId     Int
  userName   String
  action     String
  entityType String
  entityId   Int?
  entityRef  String?
  details    String?
  createdAt  DateTime @default(now())
  // Hash chain (F4 part B): null on rows written before the chain existed.
  // prevHash is unique so every hash has at most one successor; the first
  // chained row uses the "GENESIS" sentinel instead of null (SQLite allows
  // many NULLs in a unique index).
  prevHash   String?  @unique
  hash       String?

  @@index([createdAt])
}
```

- [ ] **Step 2: Migration erzeugen**

Run: `npx prisma migrate dev --name audit_hash_chain`
Expected: neuer Ordner `prisma/migrations/<timestamp>_audit_hash_chain/` mit zwei `ALTER TABLE "AuditLog" ADD COLUMN` und `CREATE UNIQUE INDEX "AuditLog_prevHash_key"`. SQL öffnen und prüfen, dass **kein** `DROP TABLE` ohne Datenkopie enthalten ist (baut Prisma die Tabelle doch neu auf, muss `INSERT INTO new_AuditLog (...) SELECT ... FROM AuditLog` vorhanden sein).

Run: `npx prisma generate`
Expected: Client neu erzeugt. Prisma 7 macht das nach `migrate dev` und `db push` nicht automatisch; ohne diesen Schritt kennt der Client `prevHash`/`hash` nicht und Task 2 und 3 schlagen fehl.

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Migrationstest schreiben**

`tests/integration/audit-chain-migration.test.ts` (Muster von `tests/integration/payments-migration.test.ts`):

```ts
import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js).
// Audit rows written before the hash chain must survive untouched with
// NULL prevHash/hash, and prevHash must be unique.
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();
const MIGRATION = folders.find((n) => n.endsWith("_audit_hash_chain"))!;

function applyMigration(db: Database.Database, name: string) {
  const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => db.exec(sql))();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

describe(`migration ${MIGRATION}`, () => {
  const dbPath = path.join(tmpdir(), `migration-${randomUUID()}.db`);
  const db = new Database(dbPath);
  afterAll(() => {
    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("keeps existing audit rows and enforces unique prevHash", () => {
    expect(MIGRATION).toBeDefined();
    const idx = folders.indexOf(MIGRATION);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

    db.prepare(
      `INSERT INTO "AuditLog" ("userId", "userName", "action", "entityType", "entityRef", "createdAt")
       VALUES (1, 'Alt', 'CREATE', 'Customer', 'K-1', 1700000000000)`
    ).run();

    applyMigration(db, MIGRATION);

    const rows = db.prepare(`SELECT "userName", "entityRef", "prevHash", "hash" FROM "AuditLog"`).all();
    expect(rows).toEqual([{ userName: "Alt", entityRef: "K-1", prevHash: null, hash: null }]);

    const ins = db.prepare(
      `INSERT INTO "AuditLog" ("userId", "userName", "action", "entityType", "createdAt", "prevHash", "hash")
       VALUES (1, 'Neu', 'CREATE', 'Customer', 1700000001000, ?, 'h')`
    );
    ins.run("GENESIS");
    expect(() => ins.run("GENESIS")).toThrow(/UNIQUE/i);
    // Legacy rows (NULL prevHash) may coexist
    ins.run(null);
    ins.run(null);
  });
});
```

- [ ] **Step 4: Test ausführen**

Run: `npx vitest run tests/integration/audit-chain-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Bestehende Tests prüfen und committen**

Run: `npx vitest run tests/integration`
Expected: alles grün (Schema ist additiv).

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/audit-chain-migration.test.ts
git commit -m "feat(audit): add hash chain columns to AuditLog"
```

---

### Task 2: `lib/audit-chain.ts` — Hash, Anhängen, Prüfen

**Files:**
- Create: `lib/audit-chain.ts`
- Test: `tests/unit/audit-chain-hash.test.ts`, `tests/integration/audit-chain.test.ts`

**Interfaces:**
- Consumes: `AuditLog.prevHash`/`hash` aus Task 1.
- Produces (exakt diese Namen in späteren Tasks verwenden):
  - `const GENESIS_HASH = "GENESIS"`
  - `type AuditEntryInput = { userId: number; userName: string; action: string; entityType: string; entityId?: number | null; entityRef?: string | null; details?: string | null }`
  - `computeAuditHash(fields: { prevHash: string; userId: number; userName: string; action: string; entityType: string; entityId: number | null; entityRef: string | null; details: string | null; createdAt: Date }): string`
  - `appendAuditEntry(client: PrismaClient, entry: AuditEntryInput, nowOverride?: Date): Promise<{ id: number; hash: string }>`
  - `type ChainVerification = { ok: true; checked: number; legacy: number; head: string | null } | { ok: false; checked: number; legacy: number; brokenAtId: number; reason: "missing-hash" | "prev-mismatch" | "hash-mismatch" }`
  - `verifyAuditChain(client: PrismaClient): Promise<ChainVerification>`

- [ ] **Step 1: Failing Unit-Test für die Hash-Funktion**

`tests/unit/audit-chain-hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { computeAuditHash, GENESIS_HASH } from "@/lib/audit-chain";

const base = {
  prevHash: GENESIS_HASH,
  userId: 1,
  userName: "Admin",
  action: "CREATE",
  entityType: "Customer",
  entityId: 5,
  entityRef: "K-5",
  details: '{"a":1}',
  createdAt: new Date("2026-09-30T10:15:00.123Z"),
};

describe("computeAuditHash", () => {
  it("is a 64 char hex SHA-256 over the canonical JSON array", () => {
    const expected = createHash("sha256")
      .update(JSON.stringify(["GENESIS", 1, "Admin", "CREATE", "Customer", 5, "K-5", '{"a":1}', "2026-09-30T10:15:00.123Z"]))
      .digest("hex");
    expect(computeAuditHash(base)).toBe(expected);
    expect(computeAuditHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any single field changes", () => {
    const h = computeAuditHash(base);
    const variants = [
      { prevHash: "x" },
      { userId: 2 },
      { userName: "Other" },
      { action: "DELETE" },
      { entityType: "Invoice" },
      { entityId: 6 },
      { entityRef: "K-6" },
      { details: null },
      { createdAt: new Date("2026-09-30T10:15:00.124Z") },
    ];
    for (const v of variants) expect(computeAuditHash({ ...base, ...v })).not.toBe(h);
  });

  it("distinguishes null from an empty or 'null' string", () => {
    const a = computeAuditHash({ ...base, entityRef: null });
    expect(computeAuditHash({ ...base, entityRef: "" })).not.toBe(a);
    expect(computeAuditHash({ ...base, entityRef: "null" })).not.toBe(a);
  });
});
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `npx vitest run tests/unit/audit-chain-hash.test.ts`
Expected: FAIL (`Cannot find module '@/lib/audit-chain'`).

- [ ] **Step 3: `lib/audit-chain.ts` implementieren**

```ts
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
```

- [ ] **Step 4: Unit-Test grün**

Run: `npx vitest run tests/unit/audit-chain-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Integrationstest schreiben**

`tests/integration/audit-chain.test.ts` (nutzt `createTestDatabase` aus `tests/test-utils.ts`; `beforeEach` leert `auditLog`):

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase } from "../test-utils";
import { appendAuditEntry, verifyAuditChain, GENESIS_HASH } from "@/lib/audit-chain";

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
```

- [ ] **Step 6: Integrationstest ausführen**

Run: `npx vitest run tests/integration/audit-chain.test.ts`
Expected: PASS. Der Parallel-Test läuft im selben Prozess und wird vom Adapter-Mutex ohnehin serialisiert; er beweist Linearität, nicht den Retry. Den Retry deckt Step 6b ab.

- [ ] **Step 6b: Retry-Pfad per Fake-Client testen**

`tests/unit/audit-chain-retry.test.ts`:

```ts
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
```

Run: `npx vitest run tests/unit/audit-chain-retry.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/audit-chain.ts tests/unit/audit-chain-hash.test.ts tests/unit/audit-chain-retry.test.ts tests/integration/audit-chain.test.ts
git commit -m "feat(audit): add hash chain append and verification"
```

---

### Task 3: `logAudit` und Passwort-Reset auf die Kette umstellen

**Files:**
- Modify: `lib/audit.ts`
- Modify: `app/(auth)/reset-password/actions.ts:56-72`
- Modify: `tests/unit/reset-password-actions.test.ts`
- Test: `tests/integration/audit-chain.test.ts` (ergänzen)

**Interfaces:**
- Consumes: `appendAuditEntry`, `AuditEntryInput` aus Task 2.
- Produces: `logAuditEntry(entry: AuditEntryInput, prisma?: PrismaClient): Promise<void>` in `lib/audit.ts` (never-throw); `logAudit`-Signatur unverändert.

- [ ] **Step 1: Failing Test ergänzen**

In `tests/integration/audit-chain.test.ts` oben bei den Imports ergänzen:

```ts
import { logAudit, logAuditEntry } from "@/lib/audit";
import type { Session } from "next-auth";
```

und am Dateiende einen neuen `describe`-Block anhängen (eigener `createTestDatabase()`):

```ts
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
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `npx vitest run tests/integration/audit-chain.test.ts`
Expected: FAIL (`logAuditEntry` nicht exportiert bzw. Zeilen ohne Hash).

- [ ] **Step 3: `lib/audit.ts` umbauen**

Datei ersetzen durch:

```ts
import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import type { Session } from "next-auth";
import { appendAuditEntry, type AuditEntryInput } from "@/lib/audit-chain";

const log = logger.child({ module: "audit" });

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "SEND" | "STATUS";
export type AuditEntity = "Customer" | "Invoice" | "Quote" | "Reminder" | "Service" | "User" | "Settings" | "CustomerNote" | "Expense" | "Payment";

/**
 * Writes one hash-chained audit row. Never throws: audit logging must not
 * break the main operation, but a silent failure would hide that the trail
 * has gaps — surface it to the log.
 */
export async function logAuditEntry(
  entry: AuditEntryInput,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  try {
    await appendAuditEntry(prisma, entry);
  } catch (err) {
    log.error(
      { err, action: entry.action, entityType: entry.entityType, entityId: entry.entityId },
      "Failed to write audit log"
    );
  }
}

export async function logAudit(
  session: Session,
  action: AuditAction,
  entityType: AuditEntity,
  entityId?: number,
  entityRef?: string,
  details?: Record<string, unknown>,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  await logAuditEntry(
    {
      userId: parseInt(session.user.id, 10),
      userName: session.user.name ?? session.user.email ?? "Unbekannt",
      action,
      entityType,
      entityId: entityId ?? null,
      entityRef: entityRef ?? null,
      details: details ? JSON.stringify(details) : null,
    },
    prisma
  );
}
```

- [ ] **Step 4: Passwort-Reset umstellen**

In `app/(auth)/reset-password/actions.ts` Import ergänzen: `import { logAuditEntry } from "@/lib/audit";` und den Block von `// No session exists here …` bis zum schliessenden `}` des `catch` ersetzen durch:

```ts
  // No session exists here (anonymous request), so write the entry directly.
  // logAuditEntry never throws and chains the row like every other entry.
  await logAuditEntry({
    userId,
    userName: user.name,
    action: "UPDATE",
    entityType: "User",
    entityId: userId,
    entityRef: user.email,
    details: JSON.stringify({ action: "password-reset-self-service" }),
  });
```

- [ ] **Step 5: Unit-Test des Passwort-Resets anpassen**

In `tests/unit/reset-password-actions.test.ts`:
1. Im `vi.mock("@/lib/prisma", …)`-Block die Zeile `auditLog: { create: vi.fn() },` entfernen.
2. Nach den bestehenden `vi.mock(...)`-Zeilen ergänzen: `vi.mock("@/lib/audit", () => ({ logAuditEntry: vi.fn() }));`
3. Import ergänzen: `import { logAuditEntry } from "@/lib/audit";`
4. Am Ende des Tests „success“ den Block `expect(prisma.auditLog.create).toHaveBeenCalledWith(…)` ersetzen durch:

```ts
    expect(logAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, entityType: "User", action: "UPDATE" })
    );
```

- [ ] **Step 6: Gesamte Suite**

Run: `npm test`
Expected: alles grün. Wichtig: Tests mit `vi.mock("@/lib/audit", …)` bleiben unberührt (sie mocken nur `logAudit`); Tests, die `auditLog.findMany` auf echten DB-Zeilen prüfen (`payments.test.ts`, `assign-document-number.test.ts`, `payment-matching.test.ts`), müssen weiter passen, weil sich nur Zusatzspalten ändern.

- [ ] **Step 7: Lint und Commit**

Run: `npm run lint`
Expected: keine neuen Fehler.

```bash
git add lib/audit.ts "app/(auth)/reset-password/actions.ts" tests/unit/reset-password-actions.test.ts tests/integration/audit-chain.test.ts
git commit -m "feat(audit): write all audit entries through the hash chain"
```

---

### Task 4: Prüfstatus auf der Admin-Seite

**Files:**
- Modify: `app/(app)/settings/audit/page.tsx`

**Interfaces:**
- Consumes: `verifyAuditChain(client): Promise<ChainVerification>` aus Task 2.
- Produces: Banner oberhalb der Tabelle (kein neues Export).

Die reine Logik ist in Task 2 getestet; hier nur Darstellung. Es gibt für diese Seite keine bestehenden Tests (Server Component), Verifikation daher manuell.

- [ ] **Step 1: Import und Aufruf ergänzen**

In `page.tsx` Import `import { verifyAuditChain, type ChainVerification } from "@/lib/audit-chain";` ergänzen. `Props` erweitern: `searchParams: Promise<{ page?: string; head?: string }>;` und `const { page, head } = await searchParams;`.

Die Prüfung läuft nur auf Seite 1 (sie liest die ganze Tabelle und soll nicht bei jedem Blättern laufen) und darf die Seite nie zum Absturz bringen. Nach dem bestehenden `Promise.all` einfügen:

```tsx
  let chain: ChainVerification | null = null;
  let chainError = false;
  let headKnown: boolean | null = null;
  if (currentPage === 1) {
    try {
      chain = await verifyAuditChain(prisma);
    } catch {
      chainError = true;
    }
    const wanted = (head ?? "").trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(wanted)) {
      headKnown = (await prisma.auditLog.findFirst({ where: { hash: wanted }, select: { id: true } })) !== null;
    }
  }
```

- [ ] **Step 2: Banner-Komponente und Texte**

Oberhalb von `export default` einfügen:

```tsx
const brokenReasons: Record<Extract<ChainVerification, { ok: false }>["reason"], string> = {
  "missing-hash": "Eintrag ohne Prüfsumme nach Beginn der Kette",
  "prev-mismatch": "Verkettung unterbrochen (Eintrag fehlt oder wurde eingefügt)",
  "hash-mismatch": "Inhalt des Eintrags wurde nachträglich verändert",
};

function ChainStatus({ chain }: { chain: ChainVerification }) {
  if (!chain.ok) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <p className="font-medium text-destructive">Integritätsprüfung fehlgeschlagen</p>
        <p className="mt-1">
          Eintrag Nr. {chain.brokenAtId}: {brokenReasons[chain.reason]}. Das Protokoll wurde
          möglicherweise manipuliert. Bitte Datenbank-Backup sichern und prüfen.
        </p>
      </div>
    );
  }
  if (chain.checked === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Noch keine verketteten Einträge. Neue Einträge werden ab sofort mit einer Prüfsumme gesichert.
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">Integritätsprüfung bestanden</p>
      <p className="mt-1 text-muted-foreground">
        {chain.checked} verkettete Einträge geprüft
        {chain.legacy > 0 ? `, ${chain.legacy} ältere Einträge ohne Prüfsumme` : ""}. Aktueller
        Aktueller Kopf-Hash (extern aufbewahren):{" "}
        <span className="font-mono break-all">{chain.head}</span>. Die Prüfung erkennt Änderungen
        und Löschungen einzelner Einträge, nicht aber eine vollständige Neuberechnung der Kette
        durch jemanden mit Zugriff auf die Datenbankdatei.
      </p>
    </div>
  );
}
```

Im JSX direkt nach dem Header-`div` (vor `<div className="overflow-x-auto">`) einfügen:

```tsx
      {chainError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          Die Integritätsprüfung konnte nicht ausgeführt werden. Details im Anwendungslog.
        </div>
      )}
      {chain && <ChainStatus chain={chain} />}
      {headKnown !== null && (
        <div className="rounded-md border p-3 text-sm">
          {headKnown
            ? "Der angefragte Hash kommt in der Kette vor: Einträge bis dahin sind noch vorhanden."
            : "Der angefragte Hash kommt in der Kette nicht vor: Einträge wurden entfernt oder verändert."}
        </div>
      )}
```

- [ ] **Step 3: Typecheck, Lint, Build**

Run: `npm run lint` und `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Manuell prüfen**

Run: `npm run dev`, als Admin `/settings/audit` öffnen.
Expected: (a) Banner „Integritätsprüfung bestanden“ nach ein paar Aktionen (z. B. Kunde anlegen); (b) mit `npx prisma studio` in einer Zeile `entityRef` ändern, Seite neu laden: Banner „fehlgeschlagen“ mit der passenden Eintrags-Nr. Änderung anschliessend rückgängig machen; (c) `/settings/audit?head=<Kopf-Hash aus dem Banner>` zeigt „kommt in der Kette vor“, ein beliebiger anderer 64-stelliger Hex-Wert „kommt nicht vor“; (d) auf Seite 2 erscheint kein Banner. Ohne laufende App (nur Tests) im Abschlussbericht vermerken, dass dieser Schritt nicht ausgeführt wurde.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/audit/page.tsx"
git commit -m "feat(audit): show hash chain status on the audit log page"
```

---

### Task 5: Dokumentation und Roadmap

**Files:**
- Modify: `CLAUDE.md` (Absatz „Audit logging“)
- Modify: `public/benutzerhandbuch.html` (Abschnitt `<h2>Aktivitätsprotokoll</h2>`, ca. Zeile 745)
- Modify: `FEATURE_ANALYSE.md` (F4-Eintrag in „Phase 1“ und U6)

**Interfaces:** —

- [ ] **Step 1: `CLAUDE.md`**

Den Absatz, der mit `**Audit logging** (`lib/audit.ts`)` beginnt, ersetzen durch:

```markdown
**Audit logging** (`lib/audit.ts`, `lib/audit-chain.ts`): All significant mutations call `logAudit(...)` (or `logAuditEntry(...)` when there is no session), both never-throw. Every row is hash-chained: `hash = SHA-256([prevHash, userId, userName, action, entityType, entityId, entityRef, details, createdAt])`, `prevHash` is `@unique` so the chain stays linear (writers collide on P2002 and retry), the first chained row uses the `"GENESIS"` sentinel, rows written before the chain existed keep `hash = null`. Never write to `AuditLog` directly (`prisma.auditLog.create`) — always go through `appendAuditEntry`, otherwise the chain breaks. `verifyAuditChain` runs on Einstellungen → Aktivitätsprotokoll and reports the first broken row. Never call `logAudit`/`logAuditEntry` inside a `$transaction` callback (the adapter serialises interactive transactions with a mutex, so the nested write waits on the outer one and times out). The hash is unkeyed: edits/deletions of single rows are detected, a full recompute of the chain by someone with file access is not, and deleting the *last* rows is only detectable if the head hash shown there was stored externally (`?head=<hash>` checks it).
```

- [ ] **Step 2: Benutzerhandbuch**

`grep -n "Aktivitätsprotokoll" public/benutzerhandbuch.html | cut -c1-140` ausführen, den Textabsatz direkt unter `<h2>Aktivitätsprotokoll</h2>` (nach dem Screenshot bzw. `figcaption`, sonst direkt nach der Überschrift) mit `Edit` um folgenden Absatz ergänzen (Tag-Stil vom Nachbarabsatz übernehmen, meist `<p>`):

```html
<p>Jeder neue Eintrag wird mit einer Prüfsumme gesichert, die auch die Prüfsumme des vorherigen Eintrags enthält. Über dem Protokoll zeigt die Seite das Ergebnis der Integritätsprüfung an. Erscheint die Meldung „Integritätsprüfung fehlgeschlagen“, wurde ein Eintrag nachträglich verändert oder entfernt: Datenbank-Backup sichern und den Administrator bzw. Entwickler informieren. Der angezeigte Kopf-Hash lässt sich notieren oder ausdrucken. Gibt man ihn später als Adresszusatz <code>?head=…</code> ein, prüft die Seite, ob dieser Hash noch in der Kette vorkommt, also ob die bis dahin geschriebenen Einträge noch vorhanden sind. Die Prüfung erkennt Änderungen und Löschungen einzelner Einträge, kann aber nicht ausschliessen, dass jemand mit Zugriff auf die Datenbankdatei die ganze Kette neu berechnet. Einträge aus der Zeit vor dieser Funktion haben keine Prüfsumme.</p>
```

Danach `git diff --stat public/benutzerhandbuch.html` prüfen: nur wenige Zeilen geändert, keine base64-Bilder betroffen.

- [ ] **Step 3: `FEATURE_ANALYSE.md`**

Per Textsuche (nicht Zeilennummer) die Zeile `- [ ] 4. F4 Belegarchiv und automatisches Backup (…)` und darunter `  - [ ] B Hash-Kette im Audit-Log` finden. Den Zustand von Teil A vorher mit `git log --oneline -- lib/document-archive.ts` bzw. den aktuellen Zeilentext prüfen und die Klammer entsprechend anpassen:
- Ist A noch offen: `(Teil C Backup und Teil B Hash-Kette erledigt; offen: kein PDF-Archiv mit Hash)`
- Ist A erledigt: Punkt 4 auf `- [x]` setzen mit `(alle drei Teile erledigt)`.

`  - [ ] B Hash-Kette im Audit-Log` → `  - [x] B Hash-Kette im Audit-Log`.
In der Tabellenzeile **U6** (`Das Audit-Log ist eine normale, veränderbare Tabelle`) ans Ende der **Beschreibungs-Zelle** (nicht der Belege-Spalte am Zeilenende) den Zusatz ` Hash-Kette umgesetzt (F4 B): Änderungen und Löschungen einzelner Einträge sind erkennbar, eine vollständige Neuberechnung der Kette durch Personen mit Dateizugriff nicht.` ergänzen.

- [ ] **Step 4: Abschlussprüfung**

Run: `npm test` und `npm run lint` und `git diff --stat`
Expected: alles grün; geänderte Dateien nur die in diesem Plan genannten.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md public/benutzerhandbuch.html FEATURE_ANALYSE.md
git commit -m "docs(audit): document audit hash chain and mark F4 part B done"
```

---

## Self-Review

- **Spec-Abdeckung** (F4-Zeile: „jeder Eintrag enthält den Hash des vorherigen“): Anhängen und Prüfen in Task 2, alle Schreibpfade in Task 3 (`logAudit` und der einzige direkte `auditLog.create` in `reset-password/actions.ts`; per Grep gibt es sonst keinen), Sichtbarkeit in Task 4, Doku in Task 5. Altbestände, Parallelität, Manipulation (Änderung, Löschung, eingeschobene Zeile) sind getestet. Bekannte Grenzen (Neuberechnung der Kette, Ende abschneiden) sind benannt und über den Kopf-Hash mit `?head=` abgemildert.
- **Platzhalter:** keine; die zwei bedingten Schritte (Task 2 Step 6 Fallback, Task 5 Step 3 Zustand von Teil A) nennen beide Zweige konkret.
- **Typkonsistenz:** `appendAuditEntry(client, entry, now?)`, `verifyAuditChain(client)`, `GENESIS_HASH`, `AuditEntryInput`, `ChainVerification` (Felder `ok/checked/legacy/head` bzw. `brokenAtId/reason`) und `logAuditEntry(entry, prisma?)` heissen in allen Tasks gleich.
- **Review-Ergebnis eingearbeitet:** `prisma generate` ergänzt, Retry per Fake-Client getestet (der Adapter serialisiert Transaktionen per Mutex, der Parallel-Test deckt den Retry nicht ab), Grenzen der ungeschlüsselten Kette ehrlich dokumentiert, Prüfung nur auf Seite 1 mit Fehler-Fallback.
