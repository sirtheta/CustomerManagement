"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import logger from "@/lib/logger";
import {
  PaymentError,
  deletePayment,
  getPaymentSummary,
  recordPayment,
} from "@/lib/payments";
import { toRappen } from "@/lib/calculations";
import { isValidDateString } from "@/lib/date";

const log = logger.child({ module: "payment-actions" });

function refresh(invoiceId: number) {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

function parseAmount(raw: string): number {
  return Number(raw.trim().replace(/'/g, "").replace(",", "."));
}

export async function recordPaymentAction(
  invoiceId: number,
  amountRaw: string,
  dateRaw: string,
  confirmOverpayment: boolean
): Promise<{ error?: string; needsConfirmation?: { overpaidBy: number } }> {
  const session = await requireEditor();
  const amount = parseAmount(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Der Betrag muss grösser als 0 sein." };
  // A calendar day, stored as UTC midnight like the bank import does.
  if (!isValidDateString(dateRaw)) return { error: "Ungültiges Datum." };
  const date = new Date(`${dateRaw}T00:00:00.000Z`);

  try {
    const summary = await getPaymentSummary(invoiceId);
    // Sent credit notes lower what is still owed, just like payments.
    const overpaidRappen =
      summary.paidRappen + summary.creditedRappen + toRappen(amount) - summary.totalRappen;
    if (overpaidRappen > 0 && !confirmOverpayment) {
      return { needsConfirmation: { overpaidBy: overpaidRappen / 100 } };
    }
    await recordPayment({ invoiceId, amount, date, source: "manual", actor: session });
  } catch (err) {
    if (err instanceof PaymentError) return { error: err.message };
    log.error({ invoiceId, err }, "recordPaymentAction failed");
    return { error: "Zahlung konnte nicht gespeichert werden." };
  }
  refresh(invoiceId);
  return {};
}

export async function deletePaymentAction(paymentId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { invoiceId: true },
  });
  if (!payment) return { error: "Zahlung nicht gefunden." };
  try {
    await deletePayment({ paymentId, actor: session });
  } catch (err) {
    if (err instanceof PaymentError) return { error: err.message };
    log.error({ paymentId, err }, "deletePaymentAction failed");
    return { error: "Zahlung konnte nicht gelöscht werden." };
  }
  refresh(payment.invoiceId);
  return {};
}
