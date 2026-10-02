import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { DEFAULT_PREFIXES } from "@/lib/document-number";
import { toRappen } from "@/lib/calculations";
import {
  expenseHints,
  listOpenTransactions,
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
      const names = [
        customerDisplayName(invoice.customer),
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
        customerNames: names,
      };
    });
}

export interface ImportOverview {
  incoming: Array<MatchedTransaction<OpenTransaction>>;
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
  }>;
}

export async function loadImportOverview(
  prisma: PrismaClient = defaultPrisma
): Promise<ImportOverview> {
  const [open, openInvoices, settings, categories, imports, booked] = await Promise.all([
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
  ]);

  const outgoing = open.filter((t) => t.amountCents < 0);
  const hints = await expenseHints(outgoing, prisma);
  const bookedByImport = new Map(booked.map((row) => [row.importId, row._count._all]));

  return {
    incoming: matchStatementToInvoices(open, openInvoices, settings?.invoiceNumberPrefix ?? DEFAULT_PREFIXES.invoice),
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
    })),
  };
}
