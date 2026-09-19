"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { InvoiceState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { markInvoicePaid } from "@/lib/payment-matching";
import {
  createDocumentWithItems,
  updateDocumentWithItems,
  sendDocument,
  isDocumentNumberCollision,
} from "@/lib/document-actions";

const log = logger.child({ module: "invoices" });

export type InvoiceFormState = {
  error?: string;
};

export async function createInvoice(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const session = await requireEditor();
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const dateRaw = formData.get("date") as string;
  const dueDateRaw = formData.get("dueDate") as string;

  if (!customerIdRaw || !dateRaw || !dueDateRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ err }, "createInvoice: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  let newInvoiceId: number;
  let documentNumber: string;
  try {
    ({ id: newInvoiceId, documentNumber } = await createDocumentWithItems({
      kind: "invoice",
      customerId,
      customUserText: customUserText || null,
      date: new Date(dateRaw),
      dueDate: new Date(dueDateRaw),
      totalAmount,
      discountPercent,
      items,
    }));
  } catch (err) {
    if (isDocumentNumberCollision(err)) {
      log.error({ err }, "createInvoice failed after retry");
      return { error: "Rechnungsnummer war belegt, bitte erneut versuchen." };
    }
    log.error({ err }, "createInvoice failed");
    return { error: "Rechnung konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Invoice", newInvoiceId, documentNumber);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect(`/invoices/${newInvoiceId}`);
}

export async function updateInvoice(
  id: number,
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const session = await requireEditor();
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const dateRaw = formData.get("date") as string;
  const dueDateRaw = formData.get("dueDate") as string;

  if (!customerIdRaw || !dateRaw || !dueDateRaw) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  const customerId = parseInt(customerIdRaw, 10);

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData));
  } catch (err) {
    log.error({ id, err }, "updateInvoice: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  try {
    await updateDocumentWithItems(id, {
      kind: "invoice",
      customerId,
      customUserText: customUserText || null,
      date: new Date(dateRaw),
      dueDate: new Date(dueDateRaw),
      totalAmount,
      discountPercent,
      items,
    });
  } catch (err) {
    log.error({ id, err }, "updateInvoice failed");
    return { error: "Rechnung konnte nicht gespeichert werden." };
  }

  await logAudit(session, "UPDATE", "Invoice", id);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  const from = formData.get("from") as string | null;
  const fromCustomer = from?.startsWith("customers/") ? from : null;
  redirect(`/invoices/${id}${fromCustomer ? `?from=${fromCustomer}` : ""}`);
}

export async function updateInvoiceStatus(
  id: number,
  state: InvoiceState
): Promise<void> {
  const session = await requireEditor();

  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { state: true, documentNumber: true },
  });
  if (!current) return;

  const becomingPaid = state === "Paid" && current.state !== "Paid";
  const leavingPaid = state !== "Paid" && current.state === "Paid";

  await prisma.invoice.update({
    where: { id },
    data: {
      state,
      ...(becomingPaid ? { paidDate: new Date() } : {}),
      ...(leavingPaid ? { paidDate: null } : {}),
    },
  });

  // Reminders only make sense while the invoice is Overdue; any other
  // state clears the pending one so it disappears from the Mahnungen list.
  if (state !== "Overdue") {
    await prisma.pendingReminder.deleteMany({ where: { invoiceId: id } });
  }

  await logAudit(session, "STATUS", "Invoice", id, current.documentNumber, {
    from: current.state,
    to: state,
  });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

export async function updateInvoicePaidDate(
  id: number,
  paidDateRaw: string
): Promise<void> {
  const session = await requireEditor();

  const paidDate = new Date(paidDateRaw);
  if (isNaN(paidDate.getTime())) return;

  const invoice = await prisma.invoice.update({
    where: { id },
    data: { paidDate },
    select: { documentNumber: true },
  });

  await logAudit(session, "UPDATE", "Invoice", id, invoice.documentNumber, { paidDate });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

export type ImportMatch = {
  invoiceId: number;
  /** Booking date from the statement entry, YYYY-MM-DD. */
  paidDate: string;
  bankReference: string | null;
};

export type ImportMatchResult = {
  error?: string;
  paidCount?: number;
};

/**
 * Marks invoices paid from confirmed CAMT-import matches (see
 * `app/(app)/invoices/import/`). Each invoice is re-checked against its
 * current state rather than trusting the preview: two people confirming the
 * same statement, or an invoice edited in between, must not clobber a state
 * the preview no longer reflects — such rows are silently skipped rather
 * than failing the whole batch.
 */
export async function markInvoicesPaidFromImport(
  matches: ImportMatch[]
): Promise<ImportMatchResult> {
  const session = await requireEditor();

  if (matches.length === 0) return { error: "Keine Zuordnung ausgewählt." };

  let paidCount = 0;

  for (const match of matches) {
    const paidDate = new Date(match.paidDate);
    if (isNaN(paidDate.getTime())) continue;

    const current = await prisma.invoice.findUnique({
      where: { id: match.invoiceId },
      select: { state: true, documentNumber: true },
    });
    if (!current || (current.state !== "Sent" && current.state !== "Overdue")) continue;

    await markInvoicePaid({
      invoiceId: match.invoiceId,
      documentNumber: current.documentNumber,
      previousState: current.state,
      paidDate,
      actor: session,
      source: "camt-import",
      bankReference: match.bankReference,
    });

    paidCount++;
  }

  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  return { paidCount };
}

export async function deleteInvoice(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { documentNumber: true } });
  try {
    await prisma.invoice.delete({ where: { id } });
  } catch (err) {
    log.error({ id, err }, "deleteInvoice failed");
    return { error: "Rechnung konnte nicht gelöscht werden. Es bestehen noch verknüpfte Daten." };
  }
  await logAudit(session, "DELETE", "Invoice", id, inv?.documentNumber);
  revalidatePath("/invoices");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/invoices");
}

export async function sendInvoice(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const idRaw = formData.get("invoiceId") as string;
  const invoiceId = parseInt(idRaw, 10);
  if (isNaN(invoiceId)) return { error: "Ungültige Rechnungs-ID." };

  const to = ((formData.get("to") as string) ?? "").trim();
  const subject = ((formData.get("subject") as string) ?? "").trim();
  const body = ((formData.get("body") as string) ?? "").trim();
  if (!to) return { error: "Bitte eine Empfänger-E-Mail-Adresse angeben." };

  const result = await sendDocument({ kind: "invoice", id: invoiceId, to, subject, body, actor: session });
  if (result.error) return { error: result.error };
  return { success: true, _ts: Date.now() };
}
