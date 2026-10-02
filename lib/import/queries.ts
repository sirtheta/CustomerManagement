import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { DEFAULT_PREFIXES } from "@/lib/document-number";
import { toRappen } from "@/lib/calculations";
import {
  expenseHints,
  listIgnoredIncoming,
  listOpenTransactions,
  pickShadowingImport,
  undoBlockedByLaterImport,
  UNDO_BLOCKED_BOOKED,
  type ExpenseHint,
  type OpenTransaction,
} from "@/lib/import/bank-import";
import {
  matchStatementToInvoices,
  type MatchedTransaction,
  type OpenInvoice,
} from "@/lib/import/matching";

/** Invoices still awaiting money, with the remaining amount after payments and credit notes. */
export async function loadOpenInvoices(
  prisma: PrismaClient = defaultPrisma
): Promise<OpenInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] }, creditNoteForId: null },
    select: {
      id: true,
      documentNumber: true,
      totalAmount: true,
      customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
      payments: { select: { amount: true } },
      creditNotes: { where: { state: { not: "Draft" } }, select: { totalAmount: true } },
      sentDocuments: {
        where: { kind: "Reminder" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { openRappen: true, feeRappen: true, interestRappen: true },
      },
    },
  });

  return invoices
    .filter((invoice): invoice is typeof invoice & { documentNumber: string } => invoice.documentNumber !== null)
    .map((invoice) => {
      const paidRappen = invoice.payments.reduce((s, p) => s + toRappen(p.amount), 0);
      const creditedRappen = invoice.creditNotes.reduce((s, c) => s + Math.abs(toRappen(c.totalAmount)), 0);
      const customerName = customerDisplayName(invoice.customer);
      const names = [
        customerName,
        invoice.customer.company ?? "",
        invoice.customer.contactPerson ?? "",
      ].filter((name, index, all) => name && all.indexOf(name) === index);
      const openRappen = Math.max(toRappen(invoice.totalAmount) - creditedRappen - paidRappen, 0);
      const lastReminder = invoice.sentDocuments[0];
      // Only a notice written for the current remainder counts; after a partial payment
      // or a credit note the old total would no longer be what the customer owes.
      const reminderRappen =
        lastReminder && lastReminder.openRappen === openRappen
          ? openRappen + (lastReminder.feeRappen ?? 0) + (lastReminder.interestRappen ?? 0)
          : 0;
      return {
        id: invoice.id,
        documentNumber: invoice.documentNumber,
        openAmount: openRappen / 100,
        ...(reminderRappen > openRappen ? { reminderTotal: reminderRappen / 100 } : {}),
        customerName,
        customerNames: names,
      };
    });
}

export interface ImportOverview {
  incoming: Array<MatchedTransaction<OpenTransaction>>;
  /** Every open invoice, for the candidate labels and the manual pick. */
  openInvoices: Array<{ id: number; documentNumber: string; customerName: string; openAmount: number }>;
  /** Ignored incoming entries (newest first, capped) and their total count. */
  ignoredIncoming: { rows: OpenTransaction[]; total: number };
  expenses: Array<{ transaction: OpenTransaction; hint: ExpenseHint }>;
  categories: Array<{ categoryId: number; name: string }>;
  imports: Array<{
    id: number;
    filename: string;
    iban: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    importedCount: number;
    skippedCount: number;
    bookedCount: number;
    balanceWarning: string | null;
    createdAt: string;
    /** Why "Rückgängig" is not possible, `null` when it is. Same texts as `undoImport`. */
    undoBlockedReason: string | null;
  }>;
}

export async function loadImportOverview(
  prisma: PrismaClient = defaultPrisma
): Promise<ImportOverview> {
  const [open, openInvoices, settings, categories, imports, booked, ignoredIncoming] = await Promise.all([
    listOpenTransactions(prisma),
    loadOpenInvoices(prisma),
    prisma.applicationSettings.findFirst({ select: { invoiceNumberPrefix: true } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { categoryId: true, name: true },
    }),
    prisma.bankStatementImport.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.bankTransaction.groupBy({
      by: ["importId"],
      where: { OR: [{ paymentId: { not: null } }, { expenseId: { not: null } }] },
      _count: { _all: true },
    }),
    listIgnoredIncoming(prisma),
  ]);

  const outgoing = open.filter((t) => t.amountCents < 0);
  const hints = await expenseHints(outgoing, prisma);
  const bookedByImport = new Map(booked.map((row) => [row.importId, row._count._all]));
  // Later imports with skipped entries may rely on a listed one (see undoImport).
  const oldestListed = imports.length > 0 ? Math.min(...imports.map((row) => row.id)) : 0;
  const shadowCandidates =
    imports.length > 0
      ? await prisma.bankStatementImport.findMany({
          where: { id: { gt: oldestListed }, skippedCount: { gt: 0 } },
          select: { id: true, filename: true, iban: true, periodFrom: true, periodTo: true },
        })
      : [];
  const undoBlockedReason = (row: (typeof imports)[number]): string | null => {
    if ((bookedByImport.get(row.id) ?? 0) > 0) return UNDO_BLOCKED_BOOKED;
    const shadowing = pickShadowingImport(row, shadowCandidates);
    return shadowing ? undoBlockedByLaterImport(shadowing.filename) : null;
  };

  return {
    incoming: matchStatementToInvoices(open, openInvoices, settings?.invoiceNumberPrefix ?? DEFAULT_PREFIXES.invoice),
    openInvoices: openInvoices
      .map((invoice) => ({
        id: invoice.id,
        documentNumber: invoice.documentNumber,
        customerName: invoice.customerName ?? "",
        openAmount: invoice.openAmount,
      }))
      .sort((a, b) => a.documentNumber.localeCompare(b.documentNumber, "de-CH", { numeric: true })),
    ignoredIncoming,
    expenses: outgoing.map((transaction) => ({ transaction, hint: hints[transaction.id] })),
    categories,
    imports: imports.map((row) => ({
      id: row.id,
      filename: row.filename,
      iban: row.iban,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      importedCount: row.importedCount,
      skippedCount: row.skippedCount,
      bookedCount: bookedByImport.get(row.id) ?? 0,
      balanceWarning: row.balanceWarning,
      createdAt: row.createdAt.toISOString(),
      undoBlockedReason: undoBlockedReason(row),
    })),
  };
}
