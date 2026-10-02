import defaultPrisma from "@/lib/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";
import { normalize, withFingerprints } from "@/lib/import/dedupe";
import { checkBalanceCompleteness, checkBalanceContinuity } from "@/lib/import/statement-checks";
import type { ParsedStatement } from "@/lib/import/types";

/** A user-facing, expected failure (German message). */
export class BankImportError extends Error {}

export interface ImportResult {
  /** `null` when nothing new was imported (every entry was already known). */
  importId: number | null;
  importedCount: number;
  skippedCount: number;
  /** Account/currency warnings passed in plus the balance warnings found here. */
  warnings: string[];
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Stores the new entries of a parsed statement. Entries whose fingerprint is
 * already known are skipped; the unique index catches the rest when two
 * uploads run at once.
 */
export async function importStatement(
  params: {
    statement: ParsedStatement;
    filename: string;
    actor: Session;
    /** Account/currency warnings computed by the caller; stored with the import. */
    accountWarnings?: string[];
  },
  prisma: PrismaClient = defaultPrisma
): Promise<ImportResult> {
  const { statement, filename, actor, accountWarnings = [] } = params;
  const hashed = withFingerprints(statement.iban, statement.transactions);

  const existing = await prisma.bankTransaction.findMany({
    where: { fingerprint: { in: hashed.map((t) => t.fingerprint) } },
    select: { fingerprint: true },
  });
  const known = new Set(existing.map((row) => row.fingerprint));
  const fresh = hashed.filter((t) => !known.has(t.fingerprint));

  if (fresh.length === 0) {
    return { importId: null, importedCount: 0, skippedCount: hashed.length, warnings: accountWarnings };
  }

  // With an overlapping import for the same account the "previous" import is
  // ambiguous, so the continuity check is skipped rather than raising a false alarm.
  const overlapping =
    statement.iban && statement.periodFrom
      ? await prisma.bankStatementImport.findFirst({
          where: { iban: statement.iban, periodTo: { gt: statement.periodFrom } },
          select: { id: true },
        })
      : null;
  const previous = statement.iban && !overlapping
    ? await prisma.bankStatementImport.findFirst({
        where: {
          iban: statement.iban,
          closingBalanceRappen: { not: null },
          ...(statement.periodFrom ? { periodTo: { lte: statement.periodFrom } } : {}),
        },
        orderBy: { periodTo: "desc" },
        select: { closingBalanceRappen: true, periodTo: true },
      })
    : null;
  const warnings = [
    ...accountWarnings,
    ...checkBalanceCompleteness(statement),
    ...checkBalanceContinuity(statement.openingBalanceCents, previous),
  ];

  const result = await prisma.$transaction(
    async (tx) => {
      const created = await tx.bankStatementImport.create({
        data: {
          filename,
          iban: statement.iban,
          currency: statement.currency,
          periodFrom: statement.periodFrom,
          periodTo: statement.periodTo,
          openingBalanceRappen: statement.openingBalanceCents,
          closingBalanceRappen: statement.closingBalanceCents,
          balanceWarning: warnings.length > 0 ? warnings.join(" ") : null,
          importedCount: 0,
          skippedCount: 0,
          userId: parseInt(actor.user.id, 10) || null,
        },
      });

      let imported = 0;
      let skipped = hashed.length - fresh.length;
      for (const t of fresh) {
        try {
          await tx.bankTransaction.create({
            data: {
              importId: created.id,
              fingerprint: t.fingerprint,
              date: new Date(t.date),
              amountRappen: t.amountCents,
              description: t.description,
              counterparty: t.counterparty,
              bankReference: t.bankReference,
            },
          });
          imported++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skipped++;
        }
      }

      if (imported === 0) {
        await tx.bankStatementImport.delete({ where: { id: created.id } });
        return { importId: null, imported, skipped };
      }
      await tx.bankStatementImport.update({
        where: { id: created.id },
        data: { importedCount: imported, skippedCount: skipped },
      });
      return { importId: created.id, imported, skipped };
    },
    { timeout: 30_000 }
  );

  if (result.importId !== null) {
    await logAudit(
      actor,
      "CREATE",
      "BankStatementImport",
      result.importId,
      filename,
      {
        imported: result.imported,
        skipped: result.skipped,
        periodFrom: statement.periodFrom,
        periodTo: statement.periodTo,
      },
      prisma
    );
  }

  return {
    importId: result.importId,
    importedCount: result.imported,
    skippedCount: result.skipped,
    warnings,
  };
}

type ImportPeriod = { id: number; iban: string | null; periodFrom: string | null; periodTo: string | null };

/** Shown when an import cannot be undone because entries of it are booked. */
export const UNDO_BLOCKED_BOOKED =
  "Aus diesem Import sind bereits Zahlungen oder Ausgaben verbucht. Bitte zuerst diese löschen: " +
  "eine Zahlung auf der jeweiligen Rechnung (Rechnungen → Rechnung öffnen → Abschnitt «Zahlungen» → " +
  "Löschen), eine Ausgabe unter Buchhaltung in der Ausgabenliste.";

/** Shown when a later overlapping import relies on this import's entries. */
export function undoBlockedByLaterImport(filename: string): string {
  return (
    `Ein späterer Import (${filename}) hat Bewegungen dieses Zeitraums als bereits bekannt übersprungen. ` +
    "Sie gingen beim Rückgängigmachen verloren. Bitte zuerst den späteren Import rückgängig machen."
  );
}

/**
 * A later import only stores entries it did not know, and which earlier
 * import the skipped ones belong to is not recorded. So any later import of
 * the same account with skipped entries and an overlapping (or unknown)
 * period may rely on this import's rows; deleting them would lose those
 * entries for good. `candidates` are imports with `skippedCount > 0`.
 */
export function pickShadowingImport<T extends ImportPeriod & { filename: string }>(
  target: ImportPeriod,
  candidates: T[]
): T | null {
  return (
    candidates
      .filter((other) => other.id > target.id)
      .sort((a, b) => a.id - b.id)
      .find((other) => {
        if (target.iban && other.iban && target.iban !== other.iban) return false;
        if (!target.periodFrom || !target.periodTo || !other.periodFrom || !other.periodTo) return true;
        // YYYY-MM-DD compares as text; inclusive because both can hold the same day.
        return other.periodFrom <= target.periodTo && target.periodFrom <= other.periodTo;
      }) ?? null
  );
}

async function findShadowingImport(
  target: ImportPeriod,
  prisma: PrismaClient
): Promise<{ filename: string } | null> {
  const later = await prisma.bankStatementImport.findMany({
    where: { id: { gt: target.id }, skippedCount: { gt: 0 } },
    select: { id: true, filename: true, iban: true, periodFrom: true, periodTo: true },
  });
  return pickShadowingImport(target, later);
}

/**
 * Deletes an import with all its entries, as long as none of them was booked
 * and no later import skipped entries that may be stored here.
 */
export async function undoImport(
  params: { importId: number; actor: Session },
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  const existing = await prisma.bankStatementImport.findUnique({
    where: { id: params.importId },
    include: { transactions: { select: { paymentId: true, expenseId: true } } },
  });
  if (!existing) throw new BankImportError("Import nicht gefunden.");
  if (existing.transactions.some((t) => t.paymentId !== null || t.expenseId !== null)) {
    throw new BankImportError(UNDO_BLOCKED_BOOKED);
  }
  const shadowing = await findShadowingImport(existing, prisma);
  if (shadowing) {
    throw new BankImportError(undoBlockedByLaterImport(shadowing.filename));
  }

  // The check above is only for the message; the delete re-checks inside the
  // transaction so an entry booked in between is never silently unlinked.
  await prisma.$transaction(async (tx) => {
    const removed = await tx.bankTransaction.deleteMany({
      where: { importId: existing.id, paymentId: null, expenseId: null },
    });
    if (removed.count !== existing.transactions.length) {
      throw new BankImportError(UNDO_BLOCKED_BOOKED);
    }
    await tx.bankStatementImport.delete({ where: { id: existing.id } });
  });
  await logAudit(
    params.actor,
    "DELETE",
    "BankStatementImport",
    existing.id,
    existing.filename,
    { transactions: existing.transactions.length },
    prisma
  );
}

export interface OpenTransaction {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  /** Signed Rappen. */
  amountCents: number;
  description: string;
  counterparty: string | null;
  bankReference: string | null;
}

/** Entries that are neither booked as payment/expense nor ignored. */
export async function listOpenTransactions(
  prisma: PrismaClient = defaultPrisma
): Promise<OpenTransaction[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: { ignored: false, paymentId: null, expenseId: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows.map(toOpenTransaction);
}

/** How many ignored incoming entries the overview lists at most (newest first). */
export const IGNORED_INCOMING_LIMIT = 200;

/**
 * Incoming entries the user ignored, newest first, so they can be opened
 * again. Booked rows never carry `ignored`, the filter only makes sure.
 */
export async function listIgnoredIncoming(
  prisma: PrismaClient = defaultPrisma
): Promise<{ rows: OpenTransaction[]; total: number }> {
  const where = { ignored: true, paymentId: null, expenseId: null, amountRappen: { gt: 0 } };
  const [rows, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: IGNORED_INCOMING_LIMIT,
    }),
    prisma.bankTransaction.count({ where }),
  ]);
  return { rows: rows.map(toOpenTransaction), total };
}

function toOpenTransaction(row: {
  id: number;
  date: Date;
  amountRappen: number;
  description: string;
  counterparty: string | null;
  bankReference: string | null;
}): OpenTransaction {
  return {
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    amountCents: row.amountRappen,
    description: row.description,
    counterparty: row.counterparty,
    bankReference: row.bankReference,
  };
}

export interface ExpenseHint {
  /** Only true when this counterparty was already taken over as an expense. */
  preselect: boolean;
  categoryId: number | null;
  /** The counterparty was ignored before and never taken over. */
  previouslyIgnored: boolean;
}

/** One earlier booked-as-expense or ignored entry; callers pass newest first. */
export interface CounterpartyHistoryRow {
  counterparty: string;
  ignored: boolean;
  hasExpense: boolean;
  expenseCategoryId: number | null;
}

/**
 * Household and business share one account, so nothing is pre-selected for a
 * counterparty without history. The newest decision wins: if the latest entry
 * of a counterparty became an expense it is pre-selected with that category,
 * if it was ignored it is marked as previously ignored.
 */
export function buildExpenseHints(
  open: OpenTransaction[],
  history: CounterpartyHistoryRow[]
): Record<number, ExpenseHint> {
  // History is newest first, so the first row per counterparty decides.
  const newest = new Map<string, CounterpartyHistoryRow>();
  for (const row of history) {
    const key = normalize(row.counterparty);
    if (!newest.has(key)) newest.set(key, row);
  }

  const hints: Record<number, ExpenseHint> = {};
  for (const transaction of open) {
    const row = newest.get(normalize(transaction.counterparty));
    hints[transaction.id] = row?.hasExpense
      ? { preselect: true, categoryId: row.expenseCategoryId, previouslyIgnored: false }
      : { preselect: false, categoryId: null, previouslyIgnored: !!row?.ignored };
  }
  return hints;
}

export async function expenseHints(
  open: OpenTransaction[],
  prisma: PrismaClient = defaultPrisma
): Promise<Record<number, ExpenseHint>> {
  const rows = await prisma.bankTransaction.findMany({
    // Outgoing only: an ignored incoming payment says nothing about expenses.
    where: {
      counterparty: { not: null },
      amountRappen: { lt: 0 },
      OR: [{ expenseId: { not: null } }, { ignored: true }],
    },
    select: {
      counterparty: true,
      ignored: true,
      expenseId: true,
      expense: { select: { categoryId: true } },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  return buildExpenseHints(
    open,
    rows.map((row) => ({
      counterparty: row.counterparty as string,
      ignored: row.ignored,
      hasExpense: row.expenseId !== null,
      expenseCategoryId: row.expense?.categoryId ?? null,
    }))
  );
}
