import { describe, it, expect, vi } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase } from "../test-utils";

vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  BankImportError,
  expenseHints,
  importStatement,
  listOpenTransactions,
  undoImport,
} from "@/lib/import/bank-import";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;
const IBAN = "CH9300762011623852957";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-03-01",
    amountCents: -450,
    description: "Kaffee",
    counterparty: "Bäckerei",
    bankReference: null,
    ...overrides,
  };
}

function statement(
  transactions: ParsedTransaction[],
  overrides: Partial<ParsedStatement> = {}
): ParsedStatement {
  return {
    transactions,
    iban: IBAN,
    currency: "CHF",
    openingBalanceCents: null,
    closingBalanceCents: null,
    periodFrom: "2026-03-01",
    periodTo: "2026-03-31",
    warnings: [],
    ...overrides,
  };
}

describe("bank import service against a real database", () => {
  const db = createTestDatabase();

  it("stores new transactions and skips known ones on re-upload", async () => {
    const file = statement([tx({ bankReference: "R1" }), tx({ bankReference: "R2", amountCents: 1000 })]);

    const first = await importStatement({ statement: file, filename: "m.xml", actor }, db.prisma);
    expect(first).toMatchObject({ importedCount: 2, skippedCount: 0 });
    expect(first.importId).not.toBeNull();

    const again = await importStatement({ statement: file, filename: "m.xml", actor }, db.prisma);
    expect(again).toMatchObject({ importId: null, importedCount: 0, skippedCount: 2 });
    expect(await db.prisma.bankStatementImport.count()).toBe(1);
    expect(await db.prisma.bankTransaction.count()).toBe(2);
  });

  it("imports only the new rows of an overlapping statement", async () => {
    await importStatement(
      { statement: statement([tx({ bankReference: "R1" })]), filename: "a.xml", actor },
      db.prisma
    );
    const result = await importStatement(
      {
        statement: statement([tx({ bankReference: "R1" }), tx({ bankReference: "R2" })]),
        filename: "b.xml",
        actor,
      },
      db.prisma
    );
    expect(result).toMatchObject({ importedCount: 1, skippedCount: 1 });
  });

  it("keeps two identical bookings without reference apart", async () => {
    const result = await importStatement(
      { statement: statement([tx(), tx()]), filename: "a.xml", actor },
      db.prisma
    );
    expect(result.importedCount).toBe(2);
    const again = await importStatement(
      { statement: statement([tx(), tx()]), filename: "a.xml", actor },
      db.prisma
    );
    expect(again.importedCount).toBe(0);
  });

  it("warns when the balances do not add up", async () => {
    const result = await importStatement(
      {
        statement: statement([tx()], { openingBalanceCents: 10000, closingBalanceCents: 9000 }),
        filename: "a.xml",
        actor,
      },
      db.prisma
    );
    expect(result.warnings.some((w) => w.includes("Saldo"))).toBe(true);
    const stored = await db.prisma.bankStatementImport.findUniqueOrThrow({ where: { id: result.importId! } });
    expect(stored.balanceWarning).toContain("Saldo");
  });

  it("stores account warnings together with the balance warnings", async () => {
    const result = await importStatement(
      {
        statement: statement([tx()], { openingBalanceCents: 10000, closingBalanceCents: 9000 }),
        filename: "w.xml",
        actor,
        accountWarnings: ["Das Konto stimmt nicht überein."],
      },
      db.prisma
    );
    expect(result.warnings[0]).toBe("Das Konto stimmt nicht überein.");
    expect(result.warnings.length).toBeGreaterThan(1);
    const stored = await db.prisma.bankStatementImport.findUniqueOrThrow({ where: { id: result.importId! } });
    expect(stored.balanceWarning).toContain("Das Konto stimmt nicht überein.");
    expect(stored.balanceWarning).toContain("Saldo");
  });

  it("does not leave an empty import behind when two uploads of the same file run at once", async () => {
    const file = statement([tx({ bankReference: "P1" }), tx({ bankReference: "P2" })]);
    const [a, b] = await Promise.all([
      importStatement({ statement: file, filename: "p.xml", actor }, db.prisma),
      importStatement({ statement: file, filename: "p.xml", actor }, db.prisma),
    ]);
    expect(a.importedCount + b.importedCount).toBe(2);
    expect(a.skippedCount + b.skippedCount).toBe(2);
    expect(await db.prisma.bankTransaction.count()).toBe(2);
    expect(await db.prisma.bankStatementImport.count()).toBe(1);
  });

  it("skips the continuity check when an overlapping import exists", async () => {
    await importStatement(
      {
        statement: statement([tx({ bankReference: "A" })], {
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          openingBalanceCents: 10000,
          closingBalanceCents: 9550,
        }),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    const overlap = await importStatement(
      {
        statement: statement([tx({ bankReference: "B", amountCents: -100 })], {
          periodFrom: "2026-03-15",
          periodTo: "2026-04-15",
          openingBalanceCents: 7000,
          closingBalanceCents: 6900,
        }),
        filename: "overlap.xml",
        actor,
      },
      db.prisma
    );
    expect(overlap.warnings).toEqual([]);
  });

  it("warns when the opening balance does not continue the previous import", async () => {
    await importStatement(
      {
        statement: statement([tx({ bankReference: "A" })], {
          periodFrom: "2026-02-01",
          periodTo: "2026-02-28",
          openingBalanceCents: 10000,
          closingBalanceCents: 9550,
        }),
        filename: "feb.xml",
        actor,
      },
      db.prisma
    );
    const march = await importStatement(
      {
        statement: statement([tx({ bankReference: "B", amountCents: -100 })], {
          openingBalanceCents: 8000,
          closingBalanceCents: 7900,
        }),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    expect(march.warnings.some((w) => w.includes("fehlt"))).toBe(true);
  });

  it("lists open transactions only, oldest first", async () => {
    await importStatement(
      {
        statement: statement([
          tx({ date: "2026-03-05", bankReference: "B" }),
          tx({ date: "2026-03-01", bankReference: "A" }),
          tx({ date: "2026-03-09", bankReference: "C" }),
        ]),
        filename: "a.xml",
        actor,
      },
      db.prisma
    );
    const all = await db.prisma.bankTransaction.findMany({ orderBy: { id: "asc" } });
    await db.prisma.bankTransaction.update({ where: { id: all[2].id }, data: { ignored: true } });

    const open = await listOpenTransactions(db.prisma);
    expect(open.map((o) => o.date)).toEqual(["2026-03-01", "2026-03-05"]);
    expect(open[0]).toMatchObject({ amountCents: -450, counterparty: "Bäckerei" });
  });

  it("derives expense hints from earlier bookings and ignores", async () => {
    const category = await db.prisma.category.create({ data: { name: "Telefon" } });
    const first = await importStatement(
      {
        statement: statement([
          tx({ bankReference: "S1", counterparty: "Swisscom AG" }),
          tx({ bankReference: "M1", counterparty: "Migros" }),
        ]),
        filename: "feb.xml",
        actor,
      },
      db.prisma
    );
    const rows = await db.prisma.bankTransaction.findMany({
      where: { importId: first.importId! },
      orderBy: { id: "asc" },
    });
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "Swisscom", amount: 4.5, categoryId: category.categoryId },
    });
    await db.prisma.bankTransaction.update({ where: { id: rows[0].id }, data: { expenseId: expense.id } });
    await db.prisma.bankTransaction.update({ where: { id: rows[1].id }, data: { ignored: true } });

    await importStatement(
      {
        statement: statement(
          [
            tx({ bankReference: "S2", counterparty: "Swisscom AG", date: "2026-04-01" }),
            tx({ bankReference: "M2", counterparty: "Migros", date: "2026-04-02" }),
            tx({ bankReference: "N2", counterparty: "Neu GmbH", date: "2026-04-03" }),
          ],
          { periodFrom: "2026-04-01", periodTo: "2026-04-30" }
        ),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    const open = await listOpenTransactions(db.prisma);
    const hints = await expenseHints(open, db.prisma);
    const byName = Object.fromEntries(open.map((o) => [o.counterparty, hints[o.id]]));
    expect(byName["Swisscom AG"]).toEqual({
      preselect: true,
      categoryId: category.categoryId,
      previouslyIgnored: false,
    });
    expect(byName["Migros"]).toMatchObject({ preselect: false, previouslyIgnored: true });
    expect(byName["Neu GmbH"]).toMatchObject({ preselect: false, previouslyIgnored: false });
  });

  it("undoes an import whose transactions are all open or ignored", async () => {
    const result = await importStatement(
      { statement: statement([tx({ bankReference: "A" }), tx({ bankReference: "B" })]), filename: "a.xml", actor },
      db.prisma
    );
    const first = await db.prisma.bankTransaction.findFirstOrThrow();
    await db.prisma.bankTransaction.update({ where: { id: first.id }, data: { ignored: true } });

    await undoImport({ importId: result.importId!, actor }, db.prisma);
    expect(await db.prisma.bankTransaction.count()).toBe(0);
    expect(await db.prisma.bankStatementImport.count()).toBe(0);
  });

  it("refuses to undo an import that already has a booked expense", async () => {
    const result = await importStatement(
      { statement: statement([tx({ bankReference: "A" })]), filename: "a.xml", actor },
      db.prisma
    );
    const row = await db.prisma.bankTransaction.findFirstOrThrow();
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "x", amount: 4.5 },
    });
    await db.prisma.bankTransaction.update({ where: { id: row.id }, data: { expenseId: expense.id } });

    await expect(undoImport({ importId: result.importId!, actor }, db.prisma)).rejects.toBeInstanceOf(
      BankImportError
    );
    expect(await db.prisma.bankTransaction.count()).toBe(1);
  });

  it("makes a transaction open again when its expense is deleted", async () => {
    await importStatement(
      { statement: statement([tx({ bankReference: "A" })]), filename: "a.xml", actor },
      db.prisma
    );
    const row = await db.prisma.bankTransaction.findFirstOrThrow();
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "x", amount: 4.5 },
    });
    await db.prisma.bankTransaction.update({ where: { id: row.id }, data: { expenseId: expense.id } });
    expect(await listOpenTransactions(db.prisma)).toHaveLength(0);

    await db.prisma.expense.delete({ where: { id: expense.id } });
    expect(await listOpenTransactions(db.prisma)).toHaveLength(1);
  });
});
