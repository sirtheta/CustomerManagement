"use server";

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

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

  return {
    data: {
      date: new Date(date),
      description,
      amount,
      categoryId: categoryIdRaw && categoryIdRaw !== "" ? parseInt(categoryIdRaw, 10) : null,
      notes: notes || null,
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

  const expense = await prisma.expense.create({ data: parsed.data });
  await logAudit(session, "CREATE", "Expense", expense.id, expense.description);
  revalidatePath("/accounting");
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

  await prisma.expense.update({ where: { id }, data: parsed.data });
  await logAudit(session, "UPDATE", "Expense", id, parsed.data.description);
  revalidatePath("/accounting");
  redirect("/accounting");
}

export async function deleteExpense(id: number): Promise<void> {
  const session = await requireAdmin();
  const expense = await prisma.expense.findUnique({ where: { id }, select: { description: true } });
  await prisma.expense.delete({ where: { id } });
  await logAudit(session, "DELETE", "Expense", id, expense?.description);
  revalidatePath("/accounting");
}
