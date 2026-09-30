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
