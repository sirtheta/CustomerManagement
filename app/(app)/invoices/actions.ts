"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { InvoiceState } from "@prisma/client";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { generateInvoiceNumber } from "@/lib/document-number";
import { type ItemData } from "@/components/items-editor-schema";
import { parseDocumentItems } from "@/lib/form-parsers";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import type { ActionState } from "@/hooks/use-action-toast";
import logger from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { saveItemsToCatalog } from "@/lib/service-catalog";

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

  const documentNumber = await generateInvoiceNumber();

  let newInvoiceId!: number;

  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          customerId,
          documentNumber,
          customUserText: customUserText || null,
          date: new Date(dateRaw),
          dueDate: new Date(dueDateRaw),
          totalAmount,
          discountPercent,
          state: "Draft",
        },
      });

      newInvoiceId = invoice.id;

      await saveItemsToCatalog(tx, items);

      if (items.length > 0) {
        await tx.item.createMany({
          data: items.map((item) => ({
            invoiceId: invoice.id,
            name: item.name,
            description: item.description || null,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            discountPercent: item.discountPercent,
            totalAmount: item.totalAmount,
            customText: item.customText || null,
            categoryId: item.categoryId,
          })),
        });
      }
    });
  } catch (err) {
    log.error({ err }, "createInvoice failed");
    return { error: "Rechnung konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Invoice", newInvoiceId, documentNumber);
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
    await prisma.$transaction(async (tx) => {
      await tx.item.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id },
        data: {
          customerId,
          customUserText: customUserText || null,
          date: new Date(dateRaw),
          dueDate: new Date(dueDateRaw),
          totalAmount,
          discountPercent,
          version: { increment: 1 },
        },
      });

      await saveItemsToCatalog(tx, items);

      if (items.length > 0) {
        await tx.item.createMany({
          data: items.map((item) => ({
            invoiceId: id,
            name: item.name,
            description: item.description || null,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            discountPercent: item.discountPercent,
            totalAmount: item.totalAmount,
            customText: item.customText || null,
            categoryId: item.categoryId,
          })),
        });
      }
    });
  } catch (err) {
    log.error({ id, err }, "updateInvoice failed");
    return { error: "Rechnung konnte nicht gespeichert werden." };
  }

  await logAudit(session, "UPDATE", "Invoice", id);
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

  await logAudit(session, "STATUS", "Invoice", id, current.documentNumber, {
    from: current.state,
    to: state,
  });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/accounting");
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

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!invoice) return { error: "Rechnung nicht gefunden." };
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  try {
    const pdf = await generateInvoicePdf(invoice, settings);
    await sendInvoiceEmail(invoice, settings, pdf, { to, subject, body });
  } catch (err) {
    log.error({ invoiceId, to, err }, "sendInvoice failed");
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { error: message };
  }

  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoiceId }, data: { state: "Sent" } }),
    prisma.invoiceSentLog.create({
      data: { invoiceId, sentTo: to, subject },
    }),
  ]);
  await logAudit(session, "SEND", "Invoice", invoiceId, invoice.documentNumber, { to });
  revalidatePath(`/invoices/${invoiceId}`);
  return { success: true, _ts: Date.now() };
}
