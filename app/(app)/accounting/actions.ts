"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { readReceipts } from "@/lib/expense-receipts";

export type ExpenseFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

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
  const parsed = parseExpenseForm(formData);
  if ("error" in parsed) return parsed;

  const files = await readReceipts(formData.getAll("receipts"));
  if ("error" in files) return { error: files.error };

  const expense = await prisma.expense.create({
    data: {
      ...parsed.data,
      ...(files.receipts.length > 0 && { receipts: { create: files.receipts } }),
    },
  });
  await logAudit(session, "CREATE", "Expense", expense.id, expense.description);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/accounting");
}

export async function updateExpense(
  id: number,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const session = await requireEditor();
  const parsed = parseExpenseForm(formData);
  if ("error" in parsed) return parsed;

  const files = await readReceipts(formData.getAll("receipts"));
  if ("error" in files) return { error: files.error };

  await prisma.expense.update({
    where: { id },
    data: {
      ...parsed.data,
      ...(files.receipts.length > 0 && { receipts: { create: files.receipts } }),
    },
  });
  await logAudit(session, "UPDATE", "Expense", id, parsed.data.description);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/accounting");
}

export async function deleteExpense(id: number): Promise<void> {
  const session = await requireAdmin();
  const expense = await prisma.expense.findUnique({ where: { id }, select: { description: true } });
  await prisma.expense.delete({ where: { id } });
  await logAudit(session, "DELETE", "Expense", id, expense?.description);
  revalidatePath("/accounting");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

export async function deleteExpenseReceipt(receiptId: number): Promise<void> {
  const session = await requireAdmin();
  const receipt = await prisma.expenseReceipt.findUnique({
    where: { id: receiptId },
    select: { expenseId: true, name: true },
  });
  if (!receipt) return;
  await prisma.expenseReceipt.delete({ where: { id: receiptId } });
  await logAudit(session, "DELETE", "ExpenseReceipt", receiptId, receipt.name);
  revalidatePath(`/accounting/${receipt.expenseId}`);
  revalidatePath("/accounting");
}
