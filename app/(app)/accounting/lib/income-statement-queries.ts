import type { PrismaClient } from "@prisma/client";
import { InvoiceState } from "@prisma/client";

export type MonthlyResult = {
  month: string;
  monthIndex: number;
  income: number;
  expenses: number;
  net: number;
};

export type IncomeStatement = {
  selectedYear: number;
  totalIncome: number;
  totalExpenses: number;
  netResult: number;
  monthlyResults: MonthlyResult[];
  availableYears: number[];
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

export async function fetchIncomeStatement(prisma: PrismaClient, year: number): Promise<IncomeStatement> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [paidInvoices, expenses, allPaidDates, allExpenseDates] = await Promise.all([
    prisma.invoice.findMany({
      where: { state: InvoiceState.Paid, paidDate: { gte: yearStart, lt: yearEnd } },
      select: { paidDate: true, totalAmount: true },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true },
    }),
    prisma.invoice.findMany({
      where: { state: InvoiceState.Paid, paidDate: { not: null } },
      select: { paidDate: true },
    }),
    prisma.expense.findMany({ select: { date: true } }),
  ]);

  const incomeByMonth = new Array(12).fill(0) as number[];
  for (const inv of paidInvoices) {
    incomeByMonth[inv.paidDate!.getMonth()] += inv.totalAmount.toNumber();
  }

  const expensesByMonth = new Array(12).fill(0) as number[];
  for (const exp of expenses) {
    expensesByMonth[exp.date.getMonth()] += exp.amount.toNumber();
  }

  const monthlyResults: MonthlyResult[] = MONTH_LABELS.map((month, i) => ({
    month,
    monthIndex: i,
    income: incomeByMonth[i],
    expenses: expensesByMonth[i],
    net: incomeByMonth[i] - expensesByMonth[i],
  }));

  const totalIncome = incomeByMonth.reduce((sum, v) => sum + v, 0);
  const totalExpenses = expensesByMonth.reduce((sum, v) => sum + v, 0);

  const years = new Set<number>();
  for (const inv of allPaidDates) years.add(inv.paidDate!.getFullYear());
  for (const exp of allExpenseDates) years.add(exp.date.getFullYear());
  years.add(new Date().getFullYear());
  const availableYears = Array.from(years).sort((a, b) => b - a);

  return {
    selectedYear: year,
    totalIncome,
    totalExpenses,
    netResult: totalIncome - totalExpenses,
    monthlyResults,
    availableYears,
  };
}

export type IncomeRow = {
  id: number;
  documentNumber: string;
  customerName: string;
  paidDate: string;
  totalAmount: number;
};

export async function fetchPaidInvoicesForYear(prisma: PrismaClient, year: number): Promise<IncomeRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const invoices = await prisma.invoice.findMany({
    where: { state: InvoiceState.Paid, paidDate: { gte: yearStart, lt: yearEnd } },
    orderBy: { paidDate: "desc" },
    select: {
      id: true,
      documentNumber: true,
      paidDate: true,
      totalAmount: true,
      customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
    },
  });

  return invoices.map((inv) => ({
    id: inv.id,
    documentNumber: inv.documentNumber,
    customerName: inv.customer.contactInsteadOfCompany
      ? inv.customer.contactPerson
      : (inv.customer.company || inv.customer.contactPerson),
    paidDate: inv.paidDate!.toISOString(),
    totalAmount: inv.totalAmount.toNumber(),
  }));
}

export type ExpenseRow = {
  id: number;
  date: string;
  description: string;
  categoryName: string | null;
  amount: number;
};

export async function fetchExpensesForYear(prisma: PrismaClient, year: number): Promise<ExpenseRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const expenses = await prisma.expense.findMany({
    where: { date: { gte: yearStart, lt: yearEnd } },
    orderBy: { date: "desc" },
    include: { category: { select: { name: true } } },
  });

  return expenses.map((exp) => ({
    id: exp.id,
    date: exp.date.toISOString(),
    description: exp.description,
    categoryName: exp.category?.name ?? null,
    amount: exp.amount.toNumber(),
  }));
}
