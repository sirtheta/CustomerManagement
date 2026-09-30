import type { PrismaClient } from "@prisma/client";
import { buildCsv } from "@/lib/csv-export";
import { customerDisplayName, type CustomerNameFields } from "@/lib/customer-display";
import { documentLabel } from "@/lib/document-display";
import { toRappen } from "@/lib/payments";

type Money = { toNumber(): number };

export type JournalPayment = {
  id: number;
  date: Date;
  amount: Money;
  invoice: { documentNumber: string | null; customer: CustomerNameFields };
};

export type JournalExpense = {
  id: number;
  date: Date;
  description: string;
  amount: Money;
  category: { name: string } | null;
};

export type JournalRow = {
  id: number;
  date: Date;
  documentNumber: string;
  type: "Einnahme" | "Ausgabe";
  customer: string;
  category: string;
  text: string;
  amountRappen: number;
};

const typeOrder = (t: JournalRow["type"]) => (t === "Einnahme" ? 0 : 1);

/**
 * Income is booked by payment date (Ist-Methode), expenses by expense date.
 * Sorted by date, Einnahme before Ausgabe on the same day, then by id.
 */
export function buildJournal(payments: JournalPayment[], expenses: JournalExpense[]): JournalRow[] {
  const rows: JournalRow[] = [
    ...payments.map((p) => ({
      id: p.id,
      date: p.date,
      documentNumber: p.invoice.documentNumber ?? "",
      type: "Einnahme" as const,
      customer: customerDisplayName(p.invoice.customer),
      category: "",
      text: `Zahlung Rechnung ${documentLabel(p.invoice.documentNumber)}`,
      amountRappen: toRappen(p.amount),
    })),
    ...expenses.map((e) => ({
      id: e.id,
      date: e.date,
      documentNumber: "",
      type: "Ausgabe" as const,
      customer: "",
      category: e.category?.name ?? "",
      text: e.description,
      amountRappen: toRappen(e.amount),
    })),
  ];
  return rows.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || typeOrder(a.type) - typeOrder(b.type) || a.id - b.id
  );
}

export async function fetchJournal(prisma: PrismaClient, year: number): Promise<JournalRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: {
        id: true,
        date: true,
        amount: true,
        invoice: {
          select: {
            documentNumber: true,
            customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
          },
        },
      },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { id: true, date: true, description: true, amount: true, category: { select: { name: true } } },
    }),
  ]);
  return buildJournal(payments, expenses);
}

export const JOURNAL_HEADERS = ["Datum", "Beleg-Nr.", "Typ", "Kunde", "Kategorie", "Text", "Betrag (CHF)"];

export function journalCsv(rows: JournalRow[]): string {
  return buildCsv(
    JOURNAL_HEADERS,
    rows.map((r) => [
      r.date.toLocaleDateString("de-CH"),
      r.documentNumber,
      r.type,
      r.customer,
      r.category,
      r.text,
      (r.amountRappen / 100).toFixed(2),
    ])
  );
}
