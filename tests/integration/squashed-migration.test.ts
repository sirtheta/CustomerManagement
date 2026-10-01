import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js) on a
// throwaway SQLite file. Everything after release 1.5.0 lives in one migration;
// legacy data is seeded at the 1.5.0 state before that migration runs.
const MIGRATION = "20261001120000_squashed_unreleased";
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
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

const dbPaths: string[] = [];
const dbs: Database.Database[] = [];

/** A database migrated to the 1.5.0 state, i.e. right before the squashed migration. */
function legacyDb() {
  const dbPath = path.join(tmpdir(), `migration-${randomUUID()}.db`);
  const db = new Database(dbPath);
  dbPaths.push(dbPath);
  dbs.push(db);
  const idx = folders.indexOf(MIGRATION);
  expect(idx).toBeGreaterThan(0);
  for (const name of folders.slice(0, idx)) applyMigration(db, name);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const p of dbPaths.splice(0)) fs.rmSync(p, { force: true });
});

describe(`migration ${MIGRATION}`, () => {
  it("splits legacy addresses, defaults the country and flags rows for review", () => {
    const db = legacyDb();
    const insert = db.prepare(
      `INSERT INTO "Customer" ("contactPerson", "address", "city", "zipCode", "email")
       VALUES ('x', ?, 'Zürich', '8000', 'x@example.ch')`
    );
    const legacy = [
      "Musterstrasse 12a",
      "Rue du Marché 5",
      "  Hauptstrasse 3  ",
      "Postfach",
      "Weg 1, 2. Stock",
      "",
    ];
    for (const address of legacy) insert.run(address);
    db.prepare(`INSERT INTO "CompanyInformation" ("companyAddress") VALUES ('Beispielweg 1')`).run();
    db.prepare(`INSERT INTO "CompanyInformation" ("companyAddress") VALUES (NULL)`).run();

    applyMigration(db, MIGRATION);

    const rows = db
      .prepare(
        `SELECT "street", "houseNumber", "country", "addressNeedsReview" FROM "Customer" ORDER BY "customerId"`
      )
      .all();
    expect(rows).toEqual([
      { street: "Musterstrasse", houseNumber: "12a", country: "CH", addressNeedsReview: 1 },
      { street: "Rue du Marché", houseNumber: "5", country: "CH", addressNeedsReview: 1 },
      { street: "Hauptstrasse", houseNumber: "3", country: "CH", addressNeedsReview: 1 },
      { street: "Postfach", houseNumber: null, country: "CH", addressNeedsReview: 1 },
      { street: "Weg 1, 2. Stock", houseNumber: null, country: "CH", addressNeedsReview: 1 },
      { street: "", houseNumber: null, country: "CH", addressNeedsReview: 0 },
    ]);

    const company = db
      .prepare(
        `SELECT "companyStreet", "companyHouseNumber", "companyCountry", "companyAddressNeedsReview"
         FROM "CompanyInformation" ORDER BY "companyInformationId"`
      )
      .all();
    expect(company).toEqual([
      { companyStreet: "Beispielweg", companyHouseNumber: "1", companyCountry: "CH", companyAddressNeedsReview: 1 },
      { companyStreet: null, companyHouseNumber: null, companyCountry: "CH", companyAddressNeedsReview: 0 },
    ]);
  });

  it("turns yearly customers into Yearly subscriptions and drops the old columns", () => {
    const db = legacyDb();
    const insert = db.prepare(
      `INSERT INTO "Customer" ("contactPerson","address","city","zipCode","email","yearlyInvoice","nextInvoiceDate")
       VALUES (?,?,?,?,?,?,?)`
    );
    const date = new Date("2027-03-01T00:00:00.000Z").getTime();
    insert.run("Yearly Kunde", "Weg 1", "Bern", "3000", "a@test.ch", 1, date);
    insert.run("Ohne Abo", "Weg 1", "Bern", "3000", "b@test.ch", 0, null);
    insert.run("Jahr ohne Datum", "Weg 1", "Bern", "3000", "c@test.ch", 1, null);

    applyMigration(db, MIGRATION);

    const subs = db.prepare(`SELECT * FROM "Subscription"`).all() as Record<string, unknown>[];
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ interval: "Yearly", autoSend: 0, active: 1, templateId: null });
    expect(subs[0].nextInvoiceDate).toBe(date);

    const cols = (db.prepare(`PRAGMA table_info("Customer")`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("yearlyInvoice");
    expect(cols).not.toContain("nextInvoiceDate");
    expect(cols).toContain("archivedAt");
    expect(db.prepare(`SELECT count(*) AS n FROM "Customer"`).get()).toEqual({ n: 3 });
  });

  it("creates one payment per Paid invoice and leaves others alone", () => {
    const db = legacyDb();
    // FK off: the customer row is irrelevant for this test
    db.pragma("foreign_keys = OFF");
    const insert = db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state", "paidDate")
       VALUES (1, ?, 1700000000000, ?, 1702592000000, ?, ?)`
    );
    insert.run("R-1", 120.5, "Paid", 1701000000000);
    insert.run("R-2", 80, "Paid", null);
    insert.run("R-3", 50, "Sent", null);
    insert.run("R-4", 0, "Paid", null);

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

  it("keeps invoices, quotes and items and switches the foreign keys to RESTRICT", () => {
    const db = legacyDb();
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state")
       VALUES (1, 'R-1', 1700000000000, 100, 1702592000000, 'Sent')`
    ).run();
    db.prepare(
      `INSERT INTO "Quote" ("customerId", "documentNumber", "date", "totalAmount", "validUntil")
       VALUES (1, 'Q-1', 1700000000000, 10, 1702592000000)`
    ).run();
    db.prepare(
      `INSERT INTO "Item" ("name", "unit", "unitPrice", "quantity", "totalAmount", "invoiceId")
       VALUES ('Beratung', 'Hour', 100, 1, 100, 1)`
    ).run();

    applyMigration(db, MIGRATION);

    const invoice = db
      .prepare(`SELECT "documentNumber", "state", "creditNoteForId" FROM "Invoice"`)
      .get() as { documentNumber: string; state: string; creditNoteForId: number | null };
    expect(invoice).toEqual({ documentNumber: "R-1", state: "Sent", creditNoteForId: null });
    expect(db.prepare(`SELECT "documentNumber" FROM "Quote"`).get()).toEqual({ documentNumber: "Q-1" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Item"`).get()).toEqual({ n: 1 });

    const fks = db.prepare(`PRAGMA foreign_key_list("Invoice")`).all() as {
      from: string;
      on_delete: string;
    }[];
    expect(fks.find((f) => f.from === "customerId")?.on_delete).toBe("RESTRICT");
    expect(fks.find((f) => f.from === "creditNoteForId")?.on_delete).toBe("RESTRICT");

    // Drafts have no document number yet
    const cols = db.prepare(`PRAGMA table_info("Invoice")`).all() as { name: string; notnull: number }[];
    expect(cols.find((c) => c.name === "documentNumber")?.notnull).toBe(0);
  });

  it("keeps existing audit rows and enforces unique prevHash", () => {
    const db = legacyDb();
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

  it("marks existing expenses as paid on their date", () => {
    const db = legacyDb();
    const cols = db.prepare(`PRAGMA table_info("Expense")`).all() as { name: string; notnull: number; dflt_value: unknown }[];
    const required = cols.filter((c) => c.notnull === 1 && c.dflt_value === null && c.name !== "id").map((c) => c.name);
    const values: Record<string, unknown> = { date: 1700000000000, updatedAt: 1700000000000 };
    const names = required.map((n) => `"${n}"`).join(",");
    db.prepare(`INSERT INTO "Expense" (${names}) VALUES (${required.map(() => "?").join(",")})`).run(
      ...required.map((n) => values[n] ?? (/amount|price|total/i.test(n) ? 20 : "x"))
    );

    applyMigration(db, MIGRATION);

    expect(db.prepare(`SELECT "paidDate", "date" FROM "Expense"`).get()).toEqual({
      paidDate: 1700000000000,
      date: 1700000000000,
    });
  });
});
