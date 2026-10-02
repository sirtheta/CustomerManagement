import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

// Runs prisma/seed.ts (as `npm run db:seed` does) against a throwaway database
// and checks the invariants the app relies on. The seed is random (faker), so
// every run checks a different data set.
const root = process.cwd();
const migrationsDir = path.join(root, "prisma", "migrations");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

let dir: string;
let db: Database.Database;
let seedOutput = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "seed-test-"));
  const dbPath = path.join(dir, "seed.db");

  // Schema like scripts/startup.js: apply the migration SQL in order.
  const setup = new Database(dbPath);
  for (const name of fs.readdirSync(migrationsDir).sort()) {
    const file = path.join(migrationsDir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    setup.pragma("foreign_keys = OFF");
    setup.transaction(() => setup.exec(fs.readFileSync(file, "utf8")))();
    setup.pragma("foreign_keys = ON");
  }
  setup.close();

  const result = spawnSync(process.execPath, [tsxCli, "prisma/seed.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      // Forward slashes: the seed strips "file:" and hands the rest to the adapter.
      DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
      ARCHIVE_DIR: path.join(dir, "archive"),
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "seed-test-password",
      ADMIN_PASSWORD_HASH: "",
      TOTP_SECRET: "",
    },
  });
  seedOutput = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) throw new Error(`seed failed (${result.status}):\n${seedOutput}`);
  db = new Database(dbPath, { readonly: true });
}, 180_000);

afterAll(() => {
  db?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Row = { id: number; state: string; totalAmount: number; dueDate: number | string; creditNoteForId: number | null };

/** The driver adapter stores DateTime as ISO text; older rows may hold epoch milliseconds. */
const toMs = (value: number | string) => (typeof value === "number" ? value : new Date(value).getTime());

describe("prisma/seed.ts", () => {
  it("seeds a full data set", () => {
    expect(seedOutput).toMatch(/Seeding complete/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Customer"`).get()).toEqual({ n: 50 });
  });

  it("every Canceled invoice is fully covered by a sent credit note and has no payments", () => {
    const canceled = db
      .prepare(`SELECT "id", "totalAmount" FROM "Invoice" WHERE "state" = 'Canceled' AND "creditNoteForId" IS NULL`)
      .all() as Pick<Row, "id" | "totalAmount">[];
    const credited = db.prepare(
      `SELECT COALESCE(SUM(-"totalAmount"), 0) AS credited, COUNT(*) AS n FROM "Invoice"
       WHERE "creditNoteForId" = ? AND "state" <> 'Draft'`
    );
    const payments = db.prepare(`SELECT COUNT(*) AS n FROM "Payment" WHERE "invoiceId" = ?`);
    expect(canceled.length).toBeGreaterThan(0);
    for (const inv of canceled) {
      const c = credited.get(inv.id) as { credited: number; n: number };
      expect(c.n, `invoice ${inv.id}`).toBeGreaterThan(0);
      expect(Math.round(c.credited * 100), `invoice ${inv.id}`).toBe(Math.round(inv.totalAmount * 100));
      expect(payments.get(inv.id), `invoice ${inv.id}`).toEqual({ n: 0 });
    }
  });

  it("credit notes look like the ones lib/credit-notes.ts creates", () => {
    const credits = db
      .prepare(
        `SELECT c."id", c."state", c."totalAmount", c."documentNumber", o."state" AS originalState
         FROM "Invoice" c JOIN "Invoice" o ON o."id" = c."creditNoteForId"`
      )
      .all() as { id: number; state: string; totalAmount: number; documentNumber: string | null; originalState: string }[];
    const items = db.prepare(`SELECT "quantity", "totalAmount", "unitPrice" FROM "Item" WHERE "invoiceId" = ?`);
    expect(credits.length).toBeGreaterThan(0);
    for (const c of credits) {
      expect(c.totalAmount, `credit ${c.id}`).toBeLessThan(0);
      expect(c.documentNumber, `credit ${c.id}`).not.toBeNull();
      expect(c.originalState).not.toBe("Draft");
      for (const item of items.all(c.id) as { quantity: number; totalAmount: number; unitPrice: number }[]) {
        expect(item.quantity).toBeLessThan(0);
        expect(item.totalAmount).toBeLessThanOrEqual(0);
        expect(item.unitPrice).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("every Overdue invoice is past its due date", () => {
    const overdue = db
      .prepare(`SELECT "id", "dueDate" FROM "Invoice" WHERE "state" = 'Overdue'`)
      .all() as Pick<Row, "id" | "dueDate">[];
    expect(overdue.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const inv of overdue) expect(toMs(inv.dueDate), `invoice ${inv.id}`).toBeLessThan(now);
  });

  it("Paid and PartiallyPaid invoices agree with their payments", () => {
    const rows = db
      .prepare(
        `SELECT i."id", i."state", i."totalAmount", COALESCE(SUM(p."amount"), 0) AS paid
         FROM "Invoice" i LEFT JOIN "Payment" p ON p."invoiceId" = i."id"
         WHERE i."state" IN ('Paid', 'PartiallyPaid') GROUP BY i."id"`
      )
      .all() as { id: number; state: string; totalAmount: number; paid: number }[];
    for (const r of rows) {
      const paid = Math.round(r.paid * 100);
      const total = Math.round(r.totalAmount * 100);
      if (r.state === "Paid") expect(paid, `invoice ${r.id}`).toBeGreaterThanOrEqual(total);
      else {
        expect(paid, `invoice ${r.id}`).toBeGreaterThan(0);
        expect(paid, `invoice ${r.id}`).toBeLessThan(total);
      }
    }
  });

  it("drafts carry no number, everything else does", () => {
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM "Invoice" WHERE "state" = 'Draft' AND "documentNumber" IS NOT NULL`).get()
    ).toEqual({ n: 0 });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM "Invoice" WHERE "state" <> 'Draft' AND "documentNumber" IS NULL`).get()
    ).toEqual({ n: 0 });
  });
});
