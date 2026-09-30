import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js).
// Redefining "Invoice" for the Restrict foreign key must keep every row.
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();
const MIGRATION = folders.find((n) => n.endsWith("_invoice_locking_credit_notes"))!;

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

  it("keeps invoices, items and payments and switches the foreign keys to RESTRICT", () => {
    expect(MIGRATION).toBeDefined();
    const idx = folders.indexOf(MIGRATION);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state")
       VALUES (1, 'R-1', 1700000000000, 100, 1702592000000, 'Sent')`
    ).run();
    db.prepare(
      `INSERT INTO "Item" ("name", "unit", "unitPrice", "quantity", "totalAmount", "invoiceId")
       VALUES ('Beratung', 'Hour', 100, 1, 100, 1)`
    ).run();
    db.prepare(
      `INSERT INTO "Payment" ("invoiceId", "date", "amount") VALUES (1, 1700000000000, 40)`
    ).run();

    applyMigration(db, MIGRATION);

    const invoice = db
      .prepare(`SELECT "documentNumber", "state", "creditNoteForId" FROM "Invoice"`)
      .get() as { documentNumber: string; state: string; creditNoteForId: number | null };
    expect(invoice).toEqual({ documentNumber: "R-1", state: "Sent", creditNoteForId: null });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Item"`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Payment"`).get()).toEqual({ n: 1 });

    const fks = db.prepare(`PRAGMA foreign_key_list("Invoice")`).all() as {
      from: string;
      on_delete: string;
    }[];
    expect(fks.find((f) => f.from === "customerId")?.on_delete).toBe("RESTRICT");
    expect(fks.find((f) => f.from === "creditNoteForId")?.on_delete).toBe("RESTRICT");
  });
});
