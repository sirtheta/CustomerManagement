import type { InvoiceState, PrismaClient } from "@prisma/client";
import { hasBillingAddress, type BillingFields } from "@/lib/customer-billing";
import { customerDisplayName } from "@/lib/customer-display";
import { toRappen } from "@/lib/payments";

export type AgeBucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus";

export const AGE_BUCKETS: { key: AgeBucket; label: string }[] = [
  { key: "notDue", label: "Nicht fällig" },
  { key: "d0_30", label: "0–30 Tage" },
  { key: "d31_60", label: "31–60 Tage" },
  { key: "d61_90", label: "61–90 Tage" },
  { key: "d90plus", label: "über 90 Tage" },
];

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** Days since the due date; an invoice due on the cut-off day counts as 0–30. */
export function ageBucket(dueDate: Date, asOf: Date): AgeBucket {
  const days = utcDay(asOf) - utcDay(dueDate);
  if (days < 0) return "notDue";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

export type ReceivableInput = {
  id: number;
  documentNumber: string | null;
  state: InvoiceState;
  date: Date;
  dueDate: Date;
  totalAmount: { toNumber(): number };
  customer: {
    customerId: number;
    company: string | null;
    contactPerson: string | null;
    contactInsteadOfCompany: boolean;
    street?: string;
    houseNumber?: string | null;
    zipCode?: string;
    city?: string;
    country?: string;
  } & BillingFields;
  payments: { date: Date; amount: { toNumber(): number } }[];
  creditNotes?: { date: Date; totalAmount: { toNumber(): number } }[];
};

export type ReceivableRow = {
  invoiceId: number;
  documentNumber: string | null;
  customerId: number;
  customerName: string;
  customerAddress: { street: string; zip: string; city: string; country: string };
  date: Date;
  dueDate: Date;
  totalRappen: number;
  paidRappen: number;
  openRappen: number;
  creditRappen: number;
  bucket: AgeBucket | null;
};

export type ReceivablesReport = {
  asOf: Date;
  rows: ReceivableRow[];
  bucketTotals: Record<AgeBucket, number>;
  totalOpenRappen: number;
  totalCreditRappen: number;
  byCustomer: { customerId: number; customerName: string; openRappen: number; creditRappen: number }[];
};

export function buildReceivables(invoices: ReceivableInput[], asOf: Date): ReceivablesReport {
  const rows: ReceivableRow[] = [];
  const bucketTotals: Record<AgeBucket, number> = {
    notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0,
  };
  const customers = new Map<number, { customerName: string; openRappen: number; creditRappen: number }>();

  for (const inv of invoices) {
    const creditNotes = inv.creditNotes ?? [];
    if (inv.state === "Draft") continue;
    // Legacy: a manually canceled invoice has no credit notes and never counts.
    if (inv.state === "Canceled" && creditNotes.length === 0) continue;
    if (inv.date.getTime() > asOf.getTime()) continue;

    const totalRappen = toRappen(inv.totalAmount);
    const paidRappen = inv.payments
      .filter((p) => p.date.getTime() <= asOf.getTime())
      .reduce((sum, p) => sum + toRappen(p.amount), 0);
    const creditNoteRappen = creditNotes
      .filter((c) => c.date.getTime() <= asOf.getTime())
      .reduce((sum, c) => sum + Math.abs(toRappen(c.totalAmount)), 0);
    const rest = totalRappen - paidRappen - creditNoteRappen;
    if (rest === 0) continue;

    const openRappen = Math.max(rest, 0);
    const creditRappen = Math.max(-rest, 0);
    const bucket = openRappen > 0 ? ageBucket(inv.dueDate, asOf) : null;
    if (bucket) bucketTotals[bucket] += openRappen;

    const customerName = customerDisplayName(inv.customer);
    const entry = customers.get(inv.customer.customerId) ?? { customerName, openRappen: 0, creditRappen: 0 };
    entry.openRappen += openRappen;
    entry.creditRappen += creditRappen;
    customers.set(inv.customer.customerId, entry);

    rows.push({
      invoiceId: inv.id,
      documentNumber: inv.documentNumber,
      customerId: inv.customer.customerId,
      customerName,
      customerAddress: hasBillingAddress(inv.customer)
        ? {
            street: [inv.customer.billingStreet, inv.customer.billingHouseNumber].filter(Boolean).join(" "),
            zip: inv.customer.billingZipCode ?? "",
            city: inv.customer.billingCity ?? "",
            country: inv.customer.billingCountry ?? "CH",
          }
        : {
            street: [inv.customer.street, inv.customer.houseNumber].filter(Boolean).join(" "),
            zip: inv.customer.zipCode ?? "",
            city: inv.customer.city ?? "",
            country: inv.customer.country ?? "",
          },
      date: inv.date,
      dueDate: inv.dueDate,
      totalRappen,
      paidRappen,
      openRappen,
      creditRappen,
      bucket,
    });
  }

  return {
    asOf,
    rows,
    bucketTotals,
    totalOpenRappen: rows.reduce((s, r) => s + r.openRappen, 0),
    totalCreditRappen: rows.reduce((s, r) => s + r.creditRappen, 0),
    byCustomer: [...customers.entries()]
      .map(([customerId, c]) => ({ customerId, ...c }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName, "de")),
  };
}

export async function fetchReceivables(prisma: PrismaClient, asOf: Date): Promise<ReceivablesReport> {
  const invoices = await prisma.invoice.findMany({
    where: {
      state: { not: "Draft" },
      creditNoteForId: null,
      date: { lte: asOf },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      documentNumber: true,
      state: true,
      date: true,
      dueDate: true,
      totalAmount: true,
      customer: {
        select: {
          customerId: true,
          company: true,
          contactPerson: true,
          contactInsteadOfCompany: true,
          street: true,
          houseNumber: true,
          zipCode: true,
          city: true,
          country: true,
          billingStreet: true,
          billingHouseNumber: true,
          billingZipCode: true,
          billingCity: true,
          billingCountry: true,
        },
      },
      payments: { select: { date: true, amount: true } },
      creditNotes: { where: { state: { not: "Draft" } }, select: { date: true, totalAmount: true } },
    },
  });
  return buildReceivables(invoices, asOf);
}
