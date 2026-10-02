import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { createRequire } from "module";

// scripts/startup.js applies migrations in the Docker image. Before the first
// pending migration on an existing database it keeps a snapshot.
const require = createRequire(import.meta.url);
const { applyMigrations } = require("../../scripts/startup.js") as {
  applyMigrations: (db: Database.Database, migrationsDir?: string) => void;
};

const roots: string[] = [];
const dbs: Database.Database[] = [];

function setup(migrations: Record<string, string>) {
  const root = path.join(tmpdir(), `startup-${randomUUID()}`);
  roots.push(root);
  const migrationsDir = path.join(root, "migrations");
  for (const [name, sql] of Object.entries(migrations)) {
    fs.mkdirSync(path.join(migrationsDir, name), { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, name, "migration.sql"), sql);
  }
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "app.db"));
  dbs.push(db);
  return { db, migrationsDir, backups: path.join(dataDir, "backups") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const first = `CREATE TABLE "Thing" ("id" INTEGER PRIMARY KEY, "name" TEXT);`;
const second = `INSERT INTO "Thing" ("name") VALUES ('new'); ALTER TABLE "Thing" ADD COLUMN "extra" TEXT;`;

describe("startup.js migrations", () => {
  it("writes no snapshot on a fresh install", () => {
    const { db, migrationsDir, backups } = setup({ "1_first": first, "2_second": second });
    applyMigrations(db, migrationsDir);
    expect(fs.existsSync(backups)).toBe(false);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Thing"`).get()).toEqual({ n: 1 });
  });

  it("snapshots the state before the first pending migration of an existing database", () => {
    const { db, migrationsDir, backups } = setup({ "1_first": first });
    applyMigrations(db, migrationsDir);
    db.prepare(`INSERT INTO "Thing" ("name") VALUES ('old')`).run();
    fs.mkdirSync(path.join(migrationsDir, "2_second"));
    fs.writeFileSync(path.join(migrationsDir, "2_second", "migration.sql"), second);
    fs.mkdirSync(path.join(migrationsDir, "3_third"));
    fs.writeFileSync(path.join(migrationsDir, "3_third", "migration.sql"), `ALTER TABLE "Thing" ADD COLUMN "more" TEXT;`);

    applyMigrations(db, migrationsDir);

    expect(fs.readdirSync(backups)).toEqual(["pre-migration-2_second.db"]);
    expect(fs.readdirSync(backups)[0]).not.toMatch(/^db-\d{4}-\d{2}-\d{2}\.db$/);
    const snap = new Database(path.join(backups, "pre-migration-2_second.db"), { readonly: true });
    try {
      expect(snap.prepare(`SELECT "name" FROM "Thing"`).all()).toEqual([{ name: "old" }]);
      expect(snap.prepare(`PRAGMA table_info("Thing")`).all()).toHaveLength(2);
    } finally {
      snap.close();
    }
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Thing"`).get()).toEqual({ n: 2 });
  });

  it("keeps an existing snapshot and writes none when nothing is pending", () => {
    const { db, migrationsDir, backups } = setup({ "1_first": first });
    applyMigrations(db, migrationsDir);
    applyMigrations(db, migrationsDir);
    expect(fs.existsSync(backups)).toBe(false);
  });

  it("honours BACKUP_DIR", () => {
    const { db, migrationsDir } = setup({ "1_first": first });
    applyMigrations(db, migrationsDir);
    const other = path.join(path.dirname(migrationsDir), "elsewhere");
    vi.stubEnv("BACKUP_DIR", other);
    fs.mkdirSync(path.join(migrationsDir, "2_second"));
    fs.writeFileSync(path.join(migrationsDir, "2_second", "migration.sql"), second);
    applyMigrations(db, migrationsDir);
    expect(fs.readdirSync(other)).toEqual(["pre-migration-2_second.db"]);
  });

  it("only warns and still migrates when the snapshot fails", () => {
    const { db, migrationsDir, backups } = setup({ "1_first": first });
    applyMigrations(db, migrationsDir);
    // A file where the backup directory should be makes mkdir fail
    fs.writeFileSync(backups, "not a directory");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.mkdirSync(path.join(migrationsDir, "2_second"));
    fs.writeFileSync(path.join(migrationsDir, "2_second", "migration.sql"), second);

    applyMigrations(db, migrationsDir);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Snapshot before migration failed"));
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Thing"`).get()).toEqual({ n: 1 });
  });
});
