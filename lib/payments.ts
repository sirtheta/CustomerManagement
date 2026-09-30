import defaultPrisma from "@/lib/prisma";
import type { InvoiceState, Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";

export type PaymentSource = "manual" | "camt-import" | "budget-import" | "migration";

/** Validation error whose message is safe to show in the UI. */
export class PaymentError extends Error {}

type Db = PrismaClient | Prisma.TransactionClient;

export function toRappen(value: number | { toNumber(): number }): number {
  const n = typeof value === "number" ? value : value.toNumber();
  return Math.round(n * 100);
}

export function computeInvoiceState(input: {
  state: InvoiceState;
  totalRappen: number;
  paidRappen: number;
  dueDate: Date;
  now?: Date;
}): InvoiceState {
  const { state, totalRappen, paidRappen, dueDate } = input;
  if (state === "Draft" || state === "Canceled") return state;
  if (paidRappen > 0 && paidRappen >= totalRappen) return "Paid";
  if (paidRappen > 0) return "PartiallyPaid";
  if (state === "Paid" || state === "PartiallyPaid") {
    return dueDate.getTime() < (input.now ?? new Date()).getTime() ? "Overdue" : "Sent";
  }
  return state;
}

async function sumPaidRappen(db: Db, invoiceId: number): Promise<number> {
  const payments = await db.payment.findMany({ where: { invoiceId }, select: { amount: true } });
  return payments.reduce((sum, p) => sum + toRappen(p.amount), 0);
}

/**
 * Recomputes `state` and `paidDate` of an invoice from its payments.
 * Returns the previous and the new state.
 */
async function recalculateInvoiceState(
  db: Db,
  invoiceId: number
): Promise<{ from: InvoiceState; to: InvoiceState; documentNumber: string | null }> {
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { state: true, totalAmount: true, dueDate: true, documentNumber: true },
  });
  const paidRappen = await sumPaidRappen(db, invoiceId);
  const to = computeInvoiceState({
    state: invoice.state,
    totalRappen: toRappen(invoice.totalAmount),
    paidRappen,
    dueDate: invoice.dueDate,
  });

  let paidDate: Date | null = null;
  if (to === "Paid") {
    const last = await db.payment.findFirst({
      where: { invoiceId },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    });
    paidDate = last?.date ?? null;
  }

  await db.invoice.update({ where: { id: invoiceId }, data: { state: to, paidDate } });
  // A reminder only makes sense while the invoice is Overdue.
  if (to !== "Overdue") await db.pendingReminder.deleteMany({ where: { invoiceId } });

  return { from: invoice.state, to, documentNumber: invoice.documentNumber };
}

export async function getPaymentSummary(invoiceId: number, prisma: PrismaClient = defaultPrisma) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalAmount: true },
  });
  const totalRappen = toRappen(invoice.totalAmount);
  const paidRappen = await sumPaidRappen(prisma, invoiceId);
  return {
    totalRappen,
    paidRappen,
    remainingRappen: Math.max(totalRappen - paidRappen, 0),
    overpaidRappen: Math.max(paidRappen - totalRappen, 0),
  };
}

function validate(amount: number, date: Date) {
  if (!Number.isFinite(amount) || toRappen(amount) <= 0) {
    throw new PaymentError("Der Betrag muss grösser als 0 sein.");
  }
  if (isNaN(date.getTime())) throw new PaymentError("Ungültiges Datum.");
}

async function logStatusChange(
  actor: Session,
  invoiceId: number,
  change: { from: InvoiceState; to: InvoiceState; documentNumber: string | null },
  source: string,
  prisma: PrismaClient,
  extra: Record<string, unknown> = {}
) {
  if (change.from === change.to) return;
  await logAudit(
    actor,
    "STATUS",
    "Invoice",
    invoiceId,
    change.documentNumber ?? undefined,
    { from: change.from, to: change.to, source, ...extra },
    prisma
  );
}

type RecordParams = {
  invoiceId: number;
  date: Date;
  source: PaymentSource;
  bankReference?: string | null;
  actor: Session;
};

/**
 * Creates a payment and recalculates the invoice in one transaction.
 * `amount: "remaining"` books the open remainder read inside that same
 * transaction, so two concurrent "mark paid" clicks cannot both book it.
 * Returns null only for "remaining" when nothing is open.
 */
async function createPayment(
  params: RecordParams & { amount: number | "remaining" },
  prisma: PrismaClient
): Promise<{ paymentId: number; state: InvoiceState } | null> {
  if (params.amount === "remaining") {
    if (isNaN(params.date.getTime())) throw new PaymentError("Ungültiges Datum.");
  } else {
    validate(params.amount, params.date);
  }

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { state: true, totalAmount: true },
    });
    if (!invoice) throw new PaymentError("Rechnung nicht gefunden.");
    if (invoice.state === "Draft" || invoice.state === "Canceled") {
      throw new PaymentError("Für Entwürfe und stornierte Rechnungen sind keine Zahlungen möglich.");
    }
    const amountRappen =
      params.amount === "remaining"
        ? toRappen(invoice.totalAmount) - (await sumPaidRappen(tx, params.invoiceId))
        : toRappen(params.amount);
    if (amountRappen <= 0) return null;

    const payment = await tx.payment.create({
      data: {
        invoiceId: params.invoiceId,
        date: params.date,
        amount: amountRappen / 100,
        source: params.source,
        bankReference: params.bankReference ?? null,
      },
    });
    const change = await recalculateInvoiceState(tx, params.invoiceId);
    return { payment, change, amountRappen };
  });
  if (!result) return null;

  await logAudit(
    params.actor,
    "CREATE",
    "Payment",
    result.payment.id,
    result.change.documentNumber ?? undefined,
    {
      invoiceId: params.invoiceId,
      amount: result.amountRappen / 100,
      date: params.date,
      source: params.source,
      ...(params.bankReference ? { bankReference: params.bankReference } : {}),
    },
    prisma
  );
  await logStatusChange(params.actor, params.invoiceId, result.change, params.source, prisma);
  return { paymentId: result.payment.id, state: result.change.to };
}

export async function recordPayment(
  params: RecordParams & { amount: number },
  prisma: PrismaClient = defaultPrisma
): Promise<{ paymentId: number; state: InvoiceState }> {
  // Never null: validate() rejects amounts <= 0 before the transaction.
  return (await createPayment(params, prisma))!;
}

export async function recordRemainingPayment(
  params: RecordParams,
  prisma: PrismaClient = defaultPrisma
): Promise<{ paymentId: number; state: InvoiceState } | null> {
  return createPayment({ ...params, amount: "remaining" }, prisma);
}

/** Recomputes state/paidDate after the invoice total changed. */
export async function syncInvoiceState(
  params: { invoiceId: number; actor: Session; source: string },
  prisma: PrismaClient = defaultPrisma
): Promise<{ state: InvoiceState }> {
  const change = await prisma.$transaction((tx) => recalculateInvoiceState(tx, params.invoiceId));
  await logStatusChange(params.actor, params.invoiceId, change, params.source, prisma);
  return { state: change.to };
}

export async function deletePayment(
  params: { paymentId: number; actor: Session },
  prisma: PrismaClient = defaultPrisma
): Promise<{ state: InvoiceState }> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id: params.paymentId } });
    if (!existing) throw new PaymentError("Zahlung nicht gefunden.");
    await tx.payment.delete({ where: { id: params.paymentId } });
    const change = await recalculateInvoiceState(tx, existing.invoiceId);
    return { existing, change };
  });

  await logAudit(
    params.actor,
    "DELETE",
    "Payment",
    params.paymentId,
    result.change.documentNumber ?? undefined,
    {
      invoiceId: result.existing.invoiceId,
      amount: result.existing.amount.toNumber(),
      date: result.existing.date,
    },
    prisma
  );
  await logStatusChange(params.actor, result.existing.invoiceId, result.change, "manual", prisma);
  return { state: result.change.to };
}

/** Remaining amount (CHF) and count of all invoices still awaiting money. */
export async function sumOpenAmount(
  prisma: PrismaClient = defaultPrisma
): Promise<{ amount: number; count: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] } },
    select: { totalAmount: true, payments: { select: { amount: true } } },
  });
  let rappen = 0;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + toRappen(p.amount), 0);
    rappen += Math.max(toRappen(inv.totalAmount) - paid, 0);
  }
  return { amount: rappen / 100, count: invoices.length };
}
