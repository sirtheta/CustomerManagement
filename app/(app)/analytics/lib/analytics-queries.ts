import prisma from "@/lib/prisma";
import { InvoiceState } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { sumOpenAmount } from "@/lib/payments";
import { customerDisplayName } from "@/lib/customer-display";
import { documentLabel } from "@/lib/document-display";
export { categoryParamValue } from "./analytics-utils";

export function yearBounds(year: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
}

export type DrilldownInvoice = {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  date: string;
  totalAmount: number;
  state: InvoiceState;
};

const DRILLDOWN_SELECT = {
  id: true,
  documentNumber: true,
  customerId: true,
  date: true,
  totalAmount: true,
  state: true,
  customer: {
    select: {
      company: true,
      contactPerson: true,
      contactInsteadOfCompany: true,
    },
  },
} as const;

function formatDateIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mapInvoice(inv: {
  id: number;
  documentNumber: string | null;
  customerId: number;
  date: Date;
  totalAmount: { toNumber(): number };
  state: InvoiceState;
  customer: { company: string | null; contactPerson: string | null; contactInsteadOfCompany: boolean };
}): DrilldownInvoice {
  return {
    id: inv.id,
    invoiceNumber: documentLabel(inv.documentNumber),
    customerId: inv.customerId,
    customerName: customerDisplayName(inv.customer),
    date: formatDateIso(inv.date),
    totalAmount: inv.totalAmount.toNumber(),
    state: inv.state,
  };
}

export async function fetchCustomerName(customerId: number): Promise<string> {
  const c = await prisma.customer.findUnique({
    where: { customerId },
    select: { company: true, contactPerson: true, contactInsteadOfCompany: true },
  });
  return c ? customerDisplayName(c) : `Kunde #${customerId}`;
}

export async function fetchDrilldownInvoices(
  year: number,
  month?: number,
  status?: string,
  customerId?: number,
): Promise<DrilldownInvoice[]> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);

  if (month !== undefined) {
    const { start: monthStart, end: monthEnd } = monthBounds(year, month);
    const invoices = await prisma.invoice.findMany({
      where: { state: { notIn: [InvoiceState.Draft] }, creditNoteForId: null, date: { gte: monthStart, lt: monthEnd } },
      orderBy: { date: "desc" },
      select: DRILLDOWN_SELECT,
    });
    return invoices.map(mapInvoice);
  }

  if (status) {
    if (!Object.values(InvoiceState).includes(status as InvoiceState)) return [];
    const invoices = await prisma.invoice.findMany({
      where: { state: status as InvoiceState, creditNoteForId: null, date: { gte: yearStart, lt: yearEnd } },
      orderBy: { date: "desc" },
      select: DRILLDOWN_SELECT,
    });
    return invoices.map(mapInvoice);
  }

  if (customerId !== undefined) {
    const invoices = await prisma.invoice.findMany({
      where: { customerId, state: { notIn: [InvoiceState.Draft] }, creditNoteForId: null, date: { gte: yearStart, lt: yearEnd } },
      orderBy: { date: "desc" },
      select: DRILLDOWN_SELECT,
    });
    return invoices.map(mapInvoice);
  }

  return [];
}

export type DrilldownIncomeItem = {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  date: string;
  name: string;
  totalAmount: number;
};

export type DrilldownExpense = {
  id: number;
  date: string;
  description: string;
  amount: number;
};

export async function fetchDrilldownIncomeItems(
  year: number,
  categoryId: number | null,
): Promise<DrilldownIncomeItem[]> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);

  const items = await prisma.item.findMany({
    where: {
      categoryId,
      invoice: { state: InvoiceState.Paid, paidDate: { gte: yearStart, lt: yearEnd } },
    },
    orderBy: { invoice: { date: "desc" } },
    select: {
      id: true,
      name: true,
      totalAmount: true,
      invoice: {
        select: {
          id: true,
          documentNumber: true,
          date: true,
          customer: {
            select: { company: true, contactPerson: true, contactInsteadOfCompany: true },
          },
        },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    invoiceId: item.invoice!.id,
    invoiceNumber: documentLabel(item.invoice!.documentNumber),
    customerName: customerDisplayName(item.invoice!.customer),
    date: formatDateIso(item.invoice!.date),
    name: item.name,
    totalAmount: item.totalAmount.toNumber(),
  }));
}

export async function fetchDrilldownExpenses(
  year: number,
  categoryId: number | null,
): Promise<DrilldownExpense[]> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);

  const expenses = await prisma.expense.findMany({
    where: { categoryId, date: { gte: yearStart, lt: yearEnd } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, description: true, amount: true },
  });

  return expenses.map((exp) => ({
    id: exp.id,
    date: formatDateIso(exp.date),
    description: exp.description,
    amount: exp.amount.toNumber(),
  }));
}

export type MonthlyRevenue = { month: string; monthIndex: number; amount: number };
export type TopCustomer = { customerId: number; name: string; total: number };
export type CategoryAmount = { categoryId: number | null; name: string; color: string; total: number };
export type CategoryCombined = {
  categoryId: number | null;
  name: string;
  color: string;
  income: number;
  expense: number;
  total: number;
};

export type AnalyticsData = {
  annualRevenue: number;
  outstanding: number;
  outstandingCount: number;
  avgInvoiceAmount: number;
  paymentRate: number;
  monthlyRevenue: MonthlyRevenue[];
  incomeByCategory: CategoryAmount[];
  expensesByCategory: CategoryAmount[];
  combinedByCategory: CategoryCombined[];
  topCustomers: TopCustomer[];
  availableYears: number[];
  selectedYear: number;
};

const DEFAULT_CATEGORY_COLOR = "#64748b";
const UNCATEGORIZED_LABEL = "Ohne Kategorie";

export function parseCategoryParam(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function groupByCategory(
  rows: Array<{ amount: number; category: { categoryId: number; name: string; colorHex: string | null } | null }>,
): CategoryAmount[] {
  const map = new Map<number | null, CategoryAmount>();
  for (const row of rows) {
    const key = row.category?.categoryId ?? null;
    const entry = map.get(key) ?? {
      categoryId: key,
      name: row.category?.name ?? UNCATEGORIZED_LABEL,
      color: row.category?.colorHex ?? DEFAULT_CATEGORY_COLOR,
      total: 0,
    };
    entry.total += row.amount;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function combineCategoryAmounts(
  income: CategoryAmount[],
  expenses: CategoryAmount[],
): CategoryCombined[] {
  const map = new Map<number | null, CategoryCombined>();
  for (const row of income) {
    map.set(row.categoryId, { categoryId: row.categoryId, name: row.name, color: row.color, income: row.total, expense: 0, total: row.total });
  }
  for (const row of expenses) {
    const entry = map.get(row.categoryId);
    if (entry) {
      entry.expense = row.total;
      entry.total += row.total;
    } else {
      map.set(row.categoryId, { categoryId: row.categoryId, name: row.name, color: row.color, income: 0, expense: row.total, total: row.total });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

function yearRangeDescending(min: Date | null, max: Date | null): number[] {
  const currentYear = new Date().getFullYear();
  const startYear = min ? min.getFullYear() : currentYear;
  const endYear = Math.max(max ? max.getFullYear() : currentYear, currentYear);
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return years;
}

// Every Server Action / Route Handler that touches invoices, expenses,
// categories or customer names busts ANALYTICS_CACHE_TAG. The nightly cron
// (Sent → Overdue, yearly Draft invoices) runs outside request scope where
// revalidateTag is unavailable; its changes surface via the 5-minute TTL.
export const fetchAnalyticsData = unstable_cache(
  fetchAnalyticsDataUncached,
  ["analytics-data"],
  { revalidate: 300, tags: [ANALYTICS_CACHE_TAG] }
);

async function fetchAnalyticsDataUncached(year: number): Promise<AnalyticsData> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);

  const [
    annualRevenueResult,
    openResult,
    allNonDraftInvoices,
    paidInYear,
    invoiceDateRange,
    incomeItems,
    expenseRows,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { date: { gte: yearStart, lt: yearEnd } },
      _sum: { amount: true },
    }),
    sumOpenAmount(prisma),
    prisma.invoice.findMany({
      where: { state: { notIn: [InvoiceState.Draft] }, creditNoteForId: null, date: { gte: yearStart, lt: yearEnd } },
      select: { state: true, totalAmount: true },
    }),
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true, invoice: { select: { customerId: true } } },
    }),
    prisma.invoice.aggregate({ _min: { date: true }, _max: { date: true } }),
    prisma.item.findMany({
      where: { invoice: { state: InvoiceState.Paid, paidDate: { gte: yearStart, lt: yearEnd } } },
      select: {
        totalAmount: true,
        category: { select: { categoryId: true, name: true, colorHex: true } },
      },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: {
        amount: true,
        category: { select: { categoryId: true, name: true, colorHex: true } },
      },
    }),
  ]);

  const annualRevenue = annualRevenueResult._sum.amount?.toNumber() ?? 0;
  const outstanding = openResult.amount;
  const outstandingCount = openResult.count;

  const nonCanceled = allNonDraftInvoices.filter((i) => i.state !== InvoiceState.Canceled);
  const paid = allNonDraftInvoices.filter((i) => i.state === InvoiceState.Paid);
  const avgInvoiceAmount =
    nonCanceled.length > 0
      ? nonCanceled.reduce((sum, i) => sum + i.totalAmount.toNumber(), 0) / nonCanceled.length
      : 0;
  const paymentRate = nonCanceled.length > 0 ? (paid.length / nonCanceled.length) * 100 : 0;

  const monthlyMap = new Array(12).fill(0) as number[];
  for (const p of paidInYear) {
    monthlyMap[new Date(p.date).getMonth()] += p.amount.toNumber();
  }

  const totalsByCustomer = new Map<number, number>();
  for (const p of paidInYear) {
    totalsByCustomer.set(p.invoice.customerId, (totalsByCustomer.get(p.invoice.customerId) ?? 0) + p.amount.toNumber());
  }
  const topCustomerGroups = [...totalsByCustomer.entries()]
    .map(([customerId, total]) => ({ customerId, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const monthlyRevenue: MonthlyRevenue[] = MONTH_LABELS.map((month, i) => ({
    month,
    monthIndex: i,
    amount: monthlyMap[i],
  }));

  const incomeByCategory = groupByCategory(
    incomeItems.map((item) => ({ amount: item.totalAmount.toNumber(), category: item.category })),
  );
  const expensesByCategory = groupByCategory(
    expenseRows.map((exp) => ({ amount: exp.amount.toNumber(), category: exp.category })),
  );
  const combinedByCategory = combineCategoryAmounts(incomeByCategory, expensesByCategory);

  const customerIds = topCustomerGroups.map((g) => g.customerId);
  const customers =
    customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { customerId: { in: customerIds } },
          select: {
            customerId: true,
            company: true,
            contactPerson: true,
            contactInsteadOfCompany: true,
          },
        })
      : [];
  const customerMap = new Map(customers.map((c) => [c.customerId, c]));
  const topCustomers: TopCustomer[] = topCustomerGroups.map((g) => {
    const c = customerMap.get(g.customerId);
    const name = c ? customerDisplayName(c) : `Kunde #${g.customerId}`;
    return { customerId: g.customerId, name, total: g.total };
  });

  const availableYears = yearRangeDescending(
    invoiceDateRange._min.date,
    invoiceDateRange._max.date
  );

  return {
    annualRevenue,
    outstanding,
    outstandingCount,
    avgInvoiceAmount,
    paymentRate,
    monthlyRevenue,
    incomeByCategory,
    expensesByCategory,
    combinedByCategory,
    topCustomers,
    availableYears,
    selectedYear: year,
  };
}
