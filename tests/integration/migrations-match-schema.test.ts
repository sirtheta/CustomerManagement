import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Applies the migration SQL like scripts/startup.js does (the production image
// has no Prisma CLI) and lets `prisma migrate diff` compare the result with
// prisma/schema.prisma. A schema change without a matching migration (or a
// migration that drifts from the schema) shows up here as a non-empty diff.
const root = process.cwd();
const migrationsDir = path.join(root, "prisma", "migrations");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();

// Shipped with v1.5.0 (`git show customer-management-v1.5.0:prisma/migrations`).
const V1_5_0_MIGRATIONS = [
  "0_init",
  "1_invoice_document_number_unique",
  "20260827190115_add_invoice_discounts",
  "20260919140000_quote_unique_number_discount_and_indexes",
  "2_add_password_reset_token",
];

const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    for (const p of [f, `${f}-wal`, `${f}-shm`, `${f}-journal`]) fs.rmSync(p, { force: true });
  }
});

function migratedDb(order: string[]): string {
  const dbPath = path.join(tmpdir(), `migrate-diff-${randomUUID()}.db`);
  tempFiles.push(dbPath);
  const db = new Database(dbPath);
  try {
    for (const name of order) {
      const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => db.exec(sql))();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    }
  } finally {
    db.close();
  }
  return dbPath;
}

/** Runs `prisma migrate diff` from the database file to the schema; returns exit code and output. */
function diffAgainstSchema(dbPath: string) {
  // Prisma wants forward slashes in a SQLite URL, also on Windows (C:/Users/...).
  const url = `file:${path.resolve(dbPath).replace(/\\/g, "/")}`;
  const result = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script", "--exit-code"],
    { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" }
  );
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, error: result.error };
}

describe("migrations match prisma/schema.prisma", () => {
  it("a fresh install (all migrations in startup.js order) has no diff", () => {
    const { status, output, error } = diffAgainstSchema(migratedDb(folders));
    expect(error).toBeUndefined();
    expect(status, output).toBe(0);
  }, 60_000);

  it("an upgrade from v1.5.0 (1.5.0 migrations first, then the new ones) has no diff", () => {
    for (const name of V1_5_0_MIGRATIONS) expect(folders).toContain(name);
    const order = [
      ...folders.filter((n) => V1_5_0_MIGRATIONS.includes(n)),
      ...folders.filter((n) => !V1_5_0_MIGRATIONS.includes(n)),
    ];
    const { status, output, error } = diffAgainstSchema(migratedDb(order));
    expect(error).toBeUndefined();
    expect(status, output).toBe(0);
  }, 60_000);

  it("detects a drift (sanity check of the comparison itself)", () => {
    const dbPath = migratedDb(folders);
    const db = new Database(dbPath);
    db.exec(`ALTER TABLE "Customer" ADD COLUMN "driftProbe" TEXT`);
    db.close();
    const { status, output } = diffAgainstSchema(dbPath);
    expect(status, output).toBe(2);
    // SQLite drops a column by rebuilding the table without it.
    expect(output).toMatch(/CREATE TABLE "new_Customer"/);
  }, 60_000);
});
