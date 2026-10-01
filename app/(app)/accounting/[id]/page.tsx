import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import ExpenseForm from "../ExpenseForm";
import DeleteExpenseButton from "../DeleteExpenseButton";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditExpensePage({ params }: Props) {
  const { id } = await params;
  const expenseId = parseInt(id, 10);

  const [session, expense, categories, receipts] = await Promise.all([
    auth(),
    prisma.expense.findUnique({ where: { id: expenseId } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.expenseReceipt.findMany({
      where: { expenseId },
      select: { id: true, name: true, size: true },
      orderBy: { id: "asc" },
    }),
  ]);

  if (!expense) notFound();

  const serializedExpense = {
    ...expense,
    amount: expense.amount.toNumber(),
    date: expense.date.toISOString(),
    dueDate: expense.dueDate?.toISOString() ?? null,
    paidDate: expense.paidDate?.toISOString() ?? null,
  };

  return (
    <div className="space-y-6">
      <ExpenseForm
        expense={serializedExpense}
        categories={categories}
        receipts={receipts}
        canDeleteReceipts={!!session && hasRole(session, [UserRole.Admin])}
      />
      <div className="max-w-2xl flex justify-start">
        <DeleteExpenseButton expenseId={expenseId} />
      </div>
    </div>
  );
}
