import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (the same way scripts/startup.js
// does in production) on a throwaway SQLite file, with duplicate quote numbers
// seeded before the unique-index migration runs. A legacy database with
// colliding Quote.documentNumber values must not make startup abort.
const UNIQUE_MIGRATION = "20260919140000_quote_unique_number_discount_and_indexes";
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(migrationsDir, name, "migration.sql")))
  .sort();

function applyMigration(db: Database.Database, name: string) {
  const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => db.exec(sql))();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

describe(`migration ${UNIQUE_MIGRATION}`, () => {
  const dbPath = path.join(tmpdir(), `migration-${randomUUID()}.db`);
  const db = new Database(dbPath);

  afterAll(() => {
    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("dedupes colliding quote numbers instead of failing on the unique index", () => {
    const uniqueIdx = folders.indexOf(UNIQUE_MIGRATION);
    expect(uniqueIdx).toBeGreaterThan(0);

    for (const name of folders.slice(0, uniqueIdx)) applyMigration(db, name);

    db.prepare(
      `INSERT INTO "Customer" ("contactPerson", "address", "city", "zipCode", "email")
       VALUES ('Anna', 'Weg 1', 'Zürich', '8000', 'anna@example.ch')`
    ).run();
    const insertQuote = db.prepare(
      `INSERT INTO "Quote" ("customerId", "documentNumber", "date", "totalAmount", "validUntil")
       VALUES (1, ?, 1700000000000, 100, 1700000000000)`
    );
    insertQuote.run("O-26010001");
    insertQuote.run("O-26010001");
    insertQuote.run("O-26010001");
    insertQuote.run("O-26010002");

    for (const name of folders.slice(uniqueIdx)) applyMigration(db, name);

    const rows = db
      .prepare(`SELECT "id", "documentNumber" FROM "Quote" ORDER BY "id"`)
      .all() as { id: number; documentNumber: string }[];

    // Oldest row keeps its number, later duplicates get a unique suffix.
    expect(rows.map((r) => r.documentNumber)).toEqual([
      "O-26010001",
      "O-26010001-2",
      "O-26010001-3",
      "O-26010002",
    ]);
    expect(new Set(rows.map((r) => r.documentNumber)).size).toBe(rows.length);

    const index = db
      .prepare(`SELECT "name" FROM sqlite_master WHERE type = 'index' AND "name" = 'Quote_documentNumber_key'`)
      .get();
    expect(index).toBeDefined();
  });
});
