import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";

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

  const [payments, expenses, paymentDateRange, expenseDateRange] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true },
    }),
    prisma.payment.aggregate({ _min: { date: true }, _max: { date: true } }),
    prisma.expense.aggregate({ _min: { date: true }, _max: { date: true } }),
  ]);

  const incomeByMonth = new Array(12).fill(0) as number[];
  for (const pay of payments) {
    incomeByMonth[pay.date.getMonth()] += pay.amount.toNumber();
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
  if (paymentDateRange._min.date) years.add(paymentDateRange._min.date.getFullYear());
  if (paymentDateRange._max.date) years.add(paymentDateRange._max.date.getFullYear());
  if (expenseDateRange._min.date) years.add(expenseDateRange._min.date.getFullYear());
  if (expenseDateRange._max.date) years.add(expenseDateRange._max.date.getFullYear());
  years.add(new Date().getFullYear());
  // Fill the gaps between the extremes so the dropdown offers every year in
  // between, not just years that happen to have data on either boundary.
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  for (let y = minYear; y <= maxYear; y++) years.add(y);
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
  invoiceId: number;
  documentNumber: string | null;
  customerName: string;
  paidDate: string;
  amount: number;
};

export async function fetchPaymentsForYear(prisma: PrismaClient, year: number): Promise<IncomeRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const payments = await prisma.payment.findMany({
    where: { date: { gte: yearStart, lt: yearEnd } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      date: true,
      amount: true,
      invoice: {
        select: {
          id: true,
          documentNumber: true,
          customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
        },
      },
    },
  });

  return payments.map((p) => ({
    id: p.id,
    invoiceId: p.invoice.id,
    documentNumber: p.invoice.documentNumber,
    customerName: customerDisplayName(p.invoice.customer),
    paidDate: p.date.toISOString(),
    amount: p.amount.toNumber(),
  }));
}

export type ExpenseRow = {
  id: number;
  date: string;
  description: string;
  categoryName: string | null;
  amount: number;
  supplier: string | null;
  dueDate: string | null;
  paidDate: string | null;
  receiptCount: number;
};

export async function fetchExpensesForYear(prisma: PrismaClient, year: number): Promise<ExpenseRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const expenses = await prisma.expense.findMany({
    where: { date: { gte: yearStart, lt: yearEnd } },
    orderBy: { date: "desc" },
    include: {
      category: { select: { name: true } },
      _count: { select: { receipts: true } },
    },
  });

  return expenses.map((exp) => ({
    id: exp.id,
    date: exp.date.toISOString(),
    description: exp.description,
    categoryName: exp.category?.name ?? null,
    amount: exp.amount.toNumber(),
    supplier: exp.supplier,
    dueDate: exp.dueDate?.toISOString() ?? null,
    paidDate: exp.paidDate?.toISOString() ?? null,
    receiptCount: exp._count.receipts,
  }));
}
