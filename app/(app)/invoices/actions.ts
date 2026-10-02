"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { InvoiceState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import { loadTotalOptions } from "@/lib/total-options";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { assignDocumentNumber } from "@/lib/document-number";
import { PaymentError, recordRemainingPayment, syncInvoiceState } from "@/lib/payments";
import { toRappen } from "@/lib/calculations";
import { canTransitionInvoice } from "@/lib/state-manager";
import { swissToday } from "@/lib/date";
import {
  createDocumentWithItems,
  updateDocumentWithItems,
  DocumentLockedError,
  sendDocument,
} from "@/lib/document-actions";
import {
  CreditNoteError,
  assertCreditWithinOriginal,
  createCreditNoteDraft,
  negateDocumentInput,
} from "@/lib/credit-notes";

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
  const totalOptions = await loadTotalOptions();
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData, totalOptions));
  } catch (err) {
    log.error({ err }, "createInvoice: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  let newInvoiceId: number;
  try {
    ({ id: newInvoiceId } = await createDocumentWithItems({
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
    log.error({ err }, "createInvoice failed");
    return { error: "Rechnung konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Invoice", newInvoiceId);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect(`/invoices/${newInvoiceId}`);
}

export async function updateInvoice(
  id: number,
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const session = await requireEditor();
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { creditNoteForId: true, customerId: true },
  });
  if (!existing) return { error: "Rechnung nicht gefunden." };
  const isCreditNote = existing.creditNoteForId != null;
  const customerIdRaw = formData.get("customerId") as string;
  const customUserText = formData.get("customUserText") as string | null;
  const dateRaw = formData.get("date") as string;
  const dueDateRaw = formData.get("dueDate") as string;

  if (!customerIdRaw || !dateRaw || (!isCreditNote && !dueDateRaw)) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  // A credit note always belongs to the customer of its original; the form
  // only sends a hidden field, which must not be trusted.
  const customerId = isCreditNote ? existing.customerId : parseInt(customerIdRaw, 10);

  let items: ItemData[];
  let totalAmount: number;
  let discountPercent: number;
  const totalOptions = await loadTotalOptions();
  try {
    ({ items, totalAmount, discountPercent } = parseDocumentItems(formData, totalOptions));
  } catch (err) {
    log.error({ id, err }, "updateInvoice: invalid items JSON");
    return { error: "Ungültige Positionsdaten." };
  }

  let input = {
    kind: "invoice" as const,
    customerId,
    customUserText: customUserText || null,
    date: new Date(dateRaw),
    dueDate: isCreditNote ? new Date(dateRaw) : new Date(dueDateRaw),
    totalAmount,
    discountPercent,
    items,
  };
  if (isCreditNote) {
    if (items.length === 0 || items.some((item) => item.quantity <= 0)) {
      return { error: "Eine Gutschrift braucht mindestens eine Position mit positiver Menge." };
    }
    // Negated below; a negative price would turn the credit note into a charge.
    if (items.some((item) => item.unitPrice < 0)) {
      return { error: "Eine Gutschrift darf keine negativen Preise enthalten." };
    }
    if (toRappen(totalAmount) <= 0) {
      return { error: "Der Betrag der Gutschrift muss grösser als 0 sein." };
    }
    input = negateDocumentInput(input);
    try {
      await assertCreditWithinOriginal(prisma, {
        id,
        creditNoteForId: existing.creditNoteForId!,
        totalAmount: input.totalAmount,
      });
    } catch (err) {
      if (err instanceof CreditNoteError) return { error: err.message };
      throw err;
    }
  }

  try {
    await updateDocumentWithItems(id, input);
  } catch (err) {
    if (err instanceof DocumentLockedError) return { error: err.message };
    log.error({ id, err }, "updateInvoice failed");
    return { error: "Rechnung konnte nicht gespeichert werden." };
  }

  await syncInvoiceState({ invoiceId: id, actor: session, source: "edit" });
  await logAudit(session, "UPDATE", "Invoice", id);
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  const from = formData.get("from") as string | null;
  const fromCustomer = from?.startsWith("customers/") ? from : null;
  redirect(`/invoices/${id}${fromCustomer ? `?from=${fromCustomer}` : ""}`);
}

export async function updateInvoiceStatus(
  id: number,
  state: InvoiceState
): Promise<{ error?: string }> {
  const session = await requireEditor();

  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { state: true, documentNumber: true, totalAmount: true, creditNoteForId: true },
  });
  if (!current) return { error: "Rechnung nicht gefunden." };
  if (current.state === state) return {};
  if (current.creditNoteForId != null) {
    return { error: "Der Status einer Gutschrift ergibt sich aus dem Versand." };
  }
  // PartiallyPaid results from payments only. Leaving Paid/PartiallyPaid
  // works by deleting the payments, so state and payments never disagree.
  if (state === "PartiallyPaid") {
    return { error: "„Teilbezahlt“ ergibt sich aus den erfassten Zahlungen." };
  }
  const hasPayments = (await prisma.payment.count({ where: { invoiceId: id } })) > 0;
  if (hasPayments && state !== "Paid") {
    return { error: "Zum Zurücksetzen zuerst die Zahlungen löschen." };
  }
  if (state === "Paid" && current.state === "Canceled") {
    return { error: "Stornierte Rechnungen können nicht als bezahlt markiert werden." };
  }
  if (!canTransitionInvoice(current.state, state)) {
    return { error: "Dieser Statuswechsel ist nicht erlaubt." };
  }
  // Checked before any change: a zero invoice has nothing to pay, and a
  // Draft must not be turned Sent/numbered for a Paid that then fails.
  if (state === "Paid" && toRappen(current.totalAmount) <= 0) {
    return { error: "Die Rechnung hat keinen offenen Betrag." };
  }

  const NUMBERED_STATES: InvoiceState[] = ["Sent", "Overdue", "Paid"];
  let documentNumber = current.documentNumber;
  if (!current.documentNumber && NUMBERED_STATES.includes(state)) {
    documentNumber = await assignDocumentNumber("invoice", id, { actor: session });
  }

  if (state === "Paid") {
    // A Draft must become Sent first: payments are not allowed on drafts.
    if (current.state === "Draft") {
      await prisma.invoice.update({ where: { id }, data: { state: "Sent" } });
      await logAudit(session, "STATUS", "Invoice", id, documentNumber ?? undefined, {
        from: "Draft",
        to: "Sent",
      });
    }
    try {
      await recordRemainingPayment({ invoiceId: id, date: swissToday(), source: "manual", actor: session });
    } catch (err) {
      if (err instanceof PaymentError) return { error: err.message };
      throw err;
    }
  } else {
    await prisma.invoice.update({ where: { id }, data: { state } });
    await logAudit(session, "STATUS", "Invoice", id, documentNumber ?? undefined, {
      from: current.state,
      to: state,
    });
  }

  // Reminders only make sense while the invoice is Overdue; any other
  // state clears the pending one so it disappears from the Mahnungen list.
  if (state !== "Overdue") {
    await prisma.pendingReminder.deleteMany({ where: { invoiceId: id } });
  }
  // A subscription draft waiting for approval is no longer a draft: approving it
  // later would mail an invoice that is already out (or even paid).
  await prisma.pendingEmail.deleteMany({ where: { invoiceId: id } });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}

export async function deleteInvoice(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { documentNumber: true, state: true },
  });
  if (!inv) return { error: "Rechnung nicht gefunden." };
  if (inv.state !== "Draft") {
    return {
      error: "Versendete Rechnungen können nicht gelöscht werden. Stattdessen eine Gutschrift erstellen.",
    };
  }
  const paymentCount = await prisma.payment.count({ where: { invoiceId: id } });
  if (paymentCount > 0) {
    return { error: "Die Rechnung hat erfasste Zahlungen. Bitte zuerst die Zahlungen löschen." };
  }

  try {
    await prisma.invoice.delete({ where: { id } });
  } catch (err) {
    log.error({ id, err }, "deleteInvoice failed");
    return { error: "Rechnung konnte nicht gelöscht werden. Es bestehen noch verknüpfte Daten." };
  }
  await logAudit(session, "DELETE", "Invoice", id, inv.documentNumber ?? undefined);
  revalidatePath("/invoices");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/invoices");
}

export async function createCreditNote(invoiceId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  let creditId: number;
  try {
    creditId = await createCreditNoteDraft(invoiceId);
  } catch (err) {
    if (err instanceof CreditNoteError) return { error: err.message };
    log.error({ invoiceId, err }, "createCreditNote failed");
    return { error: "Gutschrift konnte nicht erstellt werden." };
  }
  await logAudit(session, "CREATE", "Invoice", creditId, undefined, { creditNoteFor: invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${creditId}/edit`);
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
