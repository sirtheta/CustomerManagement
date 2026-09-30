import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js) on a
// throwaway SQLite file. Paid invoices that exist before the payments
// migration must end up with exactly one payment over their total.
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();
const MIGRATION = folders.find((n) => n.endsWith("_payments"))!;

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

  it("creates one payment per Paid invoice and leaves others alone", () => {
    expect(MIGRATION).toBeDefined();
    const idx = folders.indexOf(MIGRATION);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

    // FK off: the customer row is irrelevant for this test
    db.pragma("foreign_keys = OFF");
    const insert = db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state", "paidDate")
       VALUES (1, ?, 1700000000000, ?, 1702592000000, ?, ?)`
    );
    insert.run("R-1", 120.5, "Paid", 1701000000000);
    insert.run("R-2", 80, "Paid", null);
    insert.run("R-3", 50, "Sent", null);

    applyMigration(db, MIGRATION);

    const rows = db
      .prepare(
        `SELECT i."documentNumber" AS nr, p."amount" AS amount, p."date" AS date, p."source" AS source
         FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" ORDER BY i."id"`
      )
      .all();
    expect(rows).toEqual([
      { nr: "R-1", amount: 120.5, date: 1701000000000, source: "migration" },
      { nr: "R-2", amount: 80, date: 1700000000000, source: "migration" },
    ]);
  });
});
