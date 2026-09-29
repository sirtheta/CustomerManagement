import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migrations on a throwaway SQLite file (like
// scripts/startup.js does) with legacy free-text addresses seeded before the
// structured-address migration runs.
const MIGRATION = "20260928120000_structured_addresses";
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

describe(`migration ${MIGRATION}`, () => {
  const dbPath = path.join(tmpdir(), `migration-${randomUUID()}.db`);
  const db = new Database(dbPath);

  afterAll(() => {
    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("splits legacy addresses, defaults the country and flags rows for review", () => {
    const idx = folders.indexOf(MIGRATION);
    expect(idx).toBeGreaterThan(0);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

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
});
