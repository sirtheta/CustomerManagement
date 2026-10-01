"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { logAudit } from "@/lib/audit";
import { parseCamt053 } from "@/lib/import/camt";
import { BankImportError, importStatement, undoImport } from "@/lib/import/bank-import";
import { checkStatementAccount } from "@/lib/import/statement-checks";
import { PaymentError, recordPayment } from "@/lib/payments";
import logger from "@/lib/logger";
import { z } from "zod";

const log = logger.child({ module: "invoices.import" });

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const INVALID_INPUT = "Ungültige Eingabe.";
const id = z.number().int().positive();
const idList = z.array(id).max(1000);
const paymentItems = z.array(z.object({ transactionId: id, invoiceId: id })).max(1000);
const expenseItems = z
  .array(z.object({ transactionId: id, categoryId: id.nullable() }))
  .max(1000);

export type UploadStatementState = {
  error?: string;
  warnings?: string[];
  importedCount?: number;
  skippedCount?: number;
};

function revalidateImport() {
  revalidatePath("/invoices/import");
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

/**
 * Parses an uploaded CAMT.053 file and stores its new entries. Nothing is
 * booked here: payments and expenses only arise from the explicit
 * confirmations below.
 */
export async function uploadStatement(
  _prev: UploadStatementState,
  formData: FormData
): Promise<UploadStatementState> {
  const session = await requireEditor();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte eine CAMT.053-Datei (.xml) auswählen." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Die Datei ist zu gross (maximal 10 MB)." };
  }

  let statement;
  try {
    statement = parseCamt053(await file.text());
  } catch (err) {
    log.error({ err }, "uploadStatement: CAMT parse failed");
    return { error: err instanceof Error ? err.message : "Datei konnte nicht gelesen werden." };
  }

  const settings = await prisma.applicationSettings.findFirst({
    select: { companyInfo: { select: { companyIBAN: true } } },
  });
  // Stored with the import so the history keeps showing them; result.warnings
  // already contains them.
  const accountWarnings = checkStatementAccount(statement, settings?.companyInfo?.companyIBAN ?? null);
  const result = await importStatement({
    statement,
    filename: file.name,
    actor: session,
    accountWarnings,
  });

  revalidateImport();
  return {
    importedCount: result.importedCount,
    skippedCount: result.skippedCount,
    warnings: [...result.warnings, ...statement.warnings],
  };
}

const isOpen = { paymentId: null, expenseId: null, ignored: false } as const;

class AlreadyBooked extends Error {}

/**
 * Books the confirmed incoming entries as payments. Every entry and invoice
 * is re-checked against its current state rather than trusting the preview:
 * a second tab or an invoice edited in between must not double-book, such
 * rows are skipped instead of failing the batch.
 */
export async function bookPayments(
  items: { transactionId: number; invoiceId: number }[]
): Promise<{ error?: string; paidCount?: number }> {
  const session = await requireEditor();
  if (!paymentItems.safeParse(items).success) return { error: INVALID_INPUT };
  if (items.length === 0) return { error: "Keine Zuordnung ausgewählt." };

  let paidCount = 0;
  for (const item of items) {
    const entry = await prisma.bankTransaction.findUnique({ where: { id: item.transactionId } });
    if (!entry || entry.ignored || entry.paymentId !== null || entry.expenseId !== null) continue;
    if (entry.amountRappen <= 0) continue;

    const invoice = await prisma.invoice.findUnique({
      where: { id: item.invoiceId },
      select: { state: true },
    });
    if (!invoice || !["Sent", "Overdue", "PartiallyPaid"].includes(invoice.state)) continue;
    if (
      entry.bankReference &&
      // One bank entry pays one invoice, so the check is global. The same entry means the
      // same reference, date and amount: payers reuse references month after month.
      (await prisma.payment.count({
        where: {
          bankReference: entry.bankReference,
          date: entry.date,
          amount: entry.amountRappen / 100,
        },
      })) > 0
    ) {
      continue;
    }

    try {
      await recordPayment({
        invoiceId: item.invoiceId,
        amount: entry.amountRappen / 100,
        date: entry.date,
        source: "camt-import",
        bankReference: entry.bankReference,
        actor: session,
        // Claim the entry inside the payment transaction: a concurrent second
        // confirmation matches no row, throws, and its payment is rolled back.
        onCreated: async (tx, paymentId) => {
          const claimed = await tx.bankTransaction.updateMany({
            where: { id: entry.id, ...isOpen },
            data: { paymentId },
          });
          if (claimed.count === 0) throw new AlreadyBooked();
        },
      });
      paidCount++;
    } catch (err) {
      if (err instanceof AlreadyBooked) continue;
      if (!(err instanceof PaymentError)) throw err;
    }
  }

  revalidateImport();
  return { paidCount };
}

/** Books the ticked outgoing entries as expenses (category optional). */
export async function bookExpenses(
  items: { transactionId: number; categoryId: number | null }[]
): Promise<{ error?: string; expenseCount?: number }> {
  const session = await requireEditor();
  if (!expenseItems.safeParse(items).success) return { error: INVALID_INPUT };
  if (items.length === 0) return { error: "Keine Ausgabe ausgewählt." };

  let expenseCount = 0;
  for (const item of items) {
    const entry = await prisma.bankTransaction.findUnique({ where: { id: item.transactionId } });
    if (!entry || entry.ignored || entry.paymentId !== null || entry.expenseId !== null) continue;
    if (entry.amountRappen >= 0) continue;

    const categoryId =
      item.categoryId !== null &&
      (await prisma.category.count({ where: { categoryId: item.categoryId } })) > 0
        ? item.categoryId
        : null;
    const description = entry.counterparty
      ? `${entry.counterparty} – ${entry.description}`
      : entry.description;

    let expense;
    try {
      expense = await prisma.$transaction(async (tx) => {
        const created = await tx.expense.create({
          data: {
            date: entry.date,
            description,
            amount: Math.abs(entry.amountRappen) / 100,
            categoryId,
          },
        });
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: entry.id, ...isOpen },
          data: { expenseId: created.id },
        });
        // Lost a race with a second confirmation: throwing rolls the expense back.
        if (claimed.count === 0) throw new AlreadyBooked();
        return created;
      });
    } catch (err) {
      if (err instanceof AlreadyBooked) continue;
      throw err;
    }

    await logAudit(session, "CREATE", "Expense", expense.id, expense.description, {
      source: "camt-import",
      bankTransactionId: entry.id,
    });
    expenseCount++;
  }

  revalidateImport();
  return { expenseCount };
}

/** Marks open entries as ignored (private bookings, transfers). */
export async function ignoreTransactions(
  ids: number[]
): Promise<{ error?: string; ignoredCount?: number }> {
  const session = await requireEditor();
  if (!idList.safeParse(ids).success) return { error: INVALID_INPUT };
  if (ids.length === 0) return { error: "Keine Bewegung ausgewählt." };

  const result = await prisma.bankTransaction.updateMany({
    where: { id: { in: ids }, ...isOpen },
    data: { ignored: true },
  });
  if (result.count > 0) {
    await logAudit(session, "UPDATE", "BankStatementImport", undefined, undefined, {
      ignoredBankTransactionIds: ids.slice(0, 100),
      count: result.count,
    });
  }
  revalidatePath("/invoices/import");
  return { ignoredCount: result.count };
}

export async function undoStatementImport(importId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  try {
    await undoImport({ importId, actor: session });
  } catch (err) {
    if (err instanceof BankImportError) return { error: err.message };
    throw err;
  }
  revalidatePath("/invoices/import");
  return {};
}
