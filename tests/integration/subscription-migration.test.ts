import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const TARGET = "20260930160000_subscriptions";

function applyUpTo(db: Database.Database, includeTarget: boolean) {
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of folders) {
    if (name === TARGET && !includeTarget) break;
    db.exec(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
    if (name === TARGET) break;
  }
}

describe("subscriptions migration", () => {
  it("turns yearly customers into Yearly subscriptions and drops the old columns", () => {
    const db = new Database(":memory:");
    applyUpTo(db, false);

    const insert = db.prepare(
      `INSERT INTO "Customer" ("contactPerson","street","city","zipCode","email","yearlyInvoice","nextInvoiceDate")
       VALUES (?,?,?,?,?,?,?)`
    );
    const date = new Date("2027-03-01T00:00:00.000Z").getTime();
    insert.run("Yearly Kunde", "Weg", "Bern", "3000", "a@test.ch", 1, date);
    insert.run("Ohne Abo", "Weg", "Bern", "3000", "b@test.ch", 0, null);
    insert.run("Jahr ohne Datum", "Weg", "Bern", "3000", "c@test.ch", 1, null);

    db.exec(readFileSync(join(MIGRATIONS, TARGET, "migration.sql"), "utf8"));

    const subs = db.prepare(`SELECT * FROM "Subscription"`).all() as Record<string, unknown>[];
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ interval: "Yearly", autoSend: 0, active: 1, templateId: null });
    expect(subs[0].nextInvoiceDate).toBe(date);

    const cols = (db.prepare(`PRAGMA table_info("Customer")`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("yearlyInvoice");
    expect(cols).not.toContain("nextInvoiceDate");
    expect(db.prepare(`SELECT count(*) AS n FROM "Customer"`).get()).toEqual({ n: 3 });
  });
});
