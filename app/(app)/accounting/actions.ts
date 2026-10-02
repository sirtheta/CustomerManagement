"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { hasRole, requireAdmin, requireEditor } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { readReceipts } from "@/lib/expense-receipts";
import { requireModule } from "@/lib/module-guard";

export type ExpenseFormState = {
  success?: boolean;
  /** Set with `success`: the form toasts first and then navigates, a server redirect would drop the toast. */
  redirectTo?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted text values, echoed back because React resets the form after an action. */
  values?: Record<string, string>;
};

/** The list shows one year at a time, so it opens on the year of the saved expense. */
function listUrlFor(date: Date): string {
  return `/accounting?year=${date.getUTCFullYear()}`;
}

const ECHO_FIELDS =["description", "date", "amount", "supplier", "dueDate", "paidDate", "notes"];

function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ECHO_FIELDS) {
    const v = formData.get(key);
    if (typeof v === "string") values[key] = v;
  }
  return values;
}

function parseExpenseForm(formData: FormData) {
  const date = formData.get("date") as string;
  const description = (formData.get("description") as string)?.trim();
  const amountRaw = formData.get("amount") as string;
  const categoryIdRaw = formData.get("categoryId") as string | null;
  const notes = (formData.get("notes") as string | null)?.trim();
  const supplier = (formData.get("supplier") as string | null)?.trim();
  const dueDateRaw = formData.get("dueDate") as string | null;
  const paid = formData.get("paid") === "on";
  const paidDateRaw = formData.get("paidDate") as string | null;

  const fieldErrors: Record<string, string> = {};
  if (!date) fieldErrors.date = "Datum ist erforderlich.";
  if (!description) fieldErrors.description = "Bezeichnung ist erforderlich.";
  if (!amountRaw) fieldErrors.amount = "Betrag ist erforderlich.";

  const amount = parseFloat(amountRaw);
  if (amountRaw && (isNaN(amount) || amount <= 0)) {
    fieldErrors.amount = "Betrag muss eine positive Zahl sein.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." as const, fieldErrors };
  }

  // Paid without an explicit payment date counts as paid on the expense date.
  const paidDate = paid ? new Date(paidDateRaw || date) : null;

  return {
    data: {
      date: new Date(date),
      description,
      amount,
      categoryId: categoryIdRaw && categoryIdRaw !== "" ? parseInt(categoryIdRaw, 10) : null,
      notes: notes || null,
      supplier: supplier || null,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      paidDate,
    },
  };
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const session = await requireEditor();
  await requireModule("accounting");
  const parsed = parseExpenseForm(formData);
  if ("error" in parsed) return { ...parsed, values: echoValues(formData) };

  const files = await readReceipts(formData.getAll("receipts"));
  if ("error" in files) return { error: files.error, values: echoValues(formData) };

  const expense = await prisma.expense.create({
    data: {
      ...parsed.data,
      ...(files.receipts.length > 0 && { receipts: { create: files.receipts } }),
    },
  });
  await logAudit(session, "CREATE", "Expense", expense.id, expense.description);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return { success: true, redirectTo: listUrlFor(parsed.data.date) };
}

export async function updateExpense(
  id: number,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const session = await requireEditor();
  await requireModule("accounting");
  const parsed = parseExpenseForm(formData);
  if ("error" in parsed) return { ...parsed, values: echoValues(formData) };

  const files = await readReceipts(formData.getAll("receipts"));
  if ("error" in files) return { error: files.error, values: echoValues(formData) };

  // Receipts marked for removal in the form are only deleted on save.
  const requestedDeletes = formData
    .getAll("deleteReceiptIds")
    .map((v) => parseInt(String(v), 10))
    .filter((n) => !isNaN(n));
  if (requestedDeletes.length > 0 && !hasRole(session, [UserRole.Admin]))
    return { error: "Belege löschen darf nur ein Admin.", values: echoValues(formData) };
  const toDelete =
    requestedDeletes.length > 0
      ? await prisma.expenseReceipt.findMany({
          where: { id: { in: requestedDeletes }, expenseId: id },
          select: { id: true, name: true },
        })
      : [];

  await prisma.expense.update({
    where: { id },
    data: {
      ...parsed.data,
      receipts: {
        ...(toDelete.length > 0 && { deleteMany: { id: { in: toDelete.map((r) => r.id) } } }),
        ...(files.receipts.length > 0 && { create: files.receipts }),
      },
    },
  });
  await logAudit(session, "UPDATE", "Expense", id, parsed.data.description);
  for (const r of toDelete) await logAudit(session, "DELETE", "ExpenseReceipt", r.id, r.name);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return { success: true, redirectTo: listUrlFor(parsed.data.date) };
}

export async function deleteExpense(id: number): Promise<void> {
  const session = await requireAdmin();
  await requireModule("accounting");
  const expense = await prisma.expense.findUnique({ where: { id }, select: { description: true } });
  await prisma.expense.delete({ where: { id } });
  await logAudit(session, "DELETE", "Expense", id, expense?.description);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}
