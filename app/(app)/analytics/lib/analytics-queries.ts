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

type CategoryRef = { categoryId: number; name: string; colorHex: string | null };
type AllocItem = { id: number; name: string; totalAmount: { toNumber(): number }; category: CategoryRef | null };

export type ItemShare<T> = { item: T | null; rappen: number };

const toRappen = (value: { toNumber(): number }) => Math.round(value.toNumber() * 100);

/**
 * Splits one payment over the invoice items by their share of the item sum,
 * so invoice discount, 5-Rappen rounding, credit notes and partial payments
 * are all covered by the amount actually received. The rounding remainder
 * goes to the largest item, so the shares always add up to the payment.
 * Without items (or an item sum of 0) the whole payment has no item.
 */
export function allocatePayment<T extends { totalAmount: { toNumber(): number } }>(
  paymentRappen: number,
  items: T[],
): ItemShare<T>[] {
  const weights = items.map((item) => toRappen(item.totalAmount));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (items.length === 0 || weightSum === 0) return [{ item: null, rappen: paymentRappen }];

  const shares = items.map((item, i) => ({ item, rappen: Math.round((paymentRappen * weights[i]) / weightSum) }));
  let largest = 0;
  for (let i = 1; i < weights.length; i++) {
    if (Math.abs(weights[i]) > Math.abs(weights[largest])) largest = i;
  }
  shares[largest].rappen += paymentRappen - shares.reduce((s, x) => s + x.rappen, 0);
  return shares;
}

const PAYMENT_ALLOCATION_SELECT = {
  date: true,
  amount: true,
  invoice: {
    select: {
      id: true,
      customerId: true,
      documentNumber: true,
      customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          totalAmount: true,
          category: { select: { categoryId: true, name: true, colorHex: true } },
        },
      },
    },
  },
} as const;

function paymentsInYear(year: number) {
  const { start, end } = yearBounds(year);
  // Same filter as the annual revenue, so the categories add up to it.
  return prisma.payment.findMany({
    where: { date: { gte: start, lt: end } },
    select: PAYMENT_ALLOCATION_SELECT,
  });
}

const NO_ITEMS_LABEL = "Ohne Positionen";

export async function fetchDrilldownIncomeItems(
  year: number,
  categoryId: number | null,
): Promise<DrilldownIncomeItem[]> {
  const payments = await paymentsInYear(year);

  // One row per item (or per itemless invoice), summed over the year's payments.
  const rows = new Map<number, DrilldownIncomeItem & { rappen: number; lastPaid: Date }>();
  for (const p of payments) {
    for (const share of allocatePayment<AllocItem>(toRappen(p.amount), p.invoice.items)) {
      if ((share.item?.category?.categoryId ?? null) !== categoryId) continue;
      // Negative ids keep itemless invoices apart from real item ids.
      const key = share.item ? share.item.id : -p.invoice.id;
      const row = rows.get(key) ?? {
        id: key,
        invoiceId: p.invoice.id,
        invoiceNumber: documentLabel(p.invoice.documentNumber),
        customerName: customerDisplayName(p.invoice.customer),
        date: "",
        name: share.item?.name ?? NO_ITEMS_LABEL,
        totalAmount: 0,
        rappen: 0,
        lastPaid: p.date,
      };
      row.rappen += share.rappen;
      if (p.date > row.lastPaid) row.lastPaid = p.date;
      rows.set(key, row);
    }
  }

  return [...rows.values()]
    .filter((row) => row.rappen !== 0)
    .sort((a, b) => b.lastPaid.getTime() - a.lastPaid.getTime() || b.id - a.id)
    .map(({ rappen, lastPaid, ...row }) => ({ ...row, date: formatDateIso(lastPaid), totalAmount: rappen / 100 }));
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
    paymentsInYear(year),
    prisma.invoice.aggregate({ _min: { date: true }, _max: { date: true } }),
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

  // Summed in Rappen so the categories add up exactly to the annual revenue.
  const incomeByCategory = groupByCategory(
    paidInYear.flatMap((p) =>
      allocatePayment<AllocItem>(toRappen(p.amount), p.invoice.items).map((share) => ({
        amount: share.rappen,
        category: share.item?.category ?? null,
      })),
    ),
  ).map((c) => ({ ...c, total: c.total / 100 }));
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
