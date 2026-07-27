import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import ExpenseForm from "../ExpenseForm";
import DeleteExpenseButton from "../DeleteExpenseButton";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditExpensePage({ params }: Props) {
  const { id } = await params;
  const expenseId = parseInt(id, 10);

  const [expense, categories] = await Promise.all([
    prisma.expense.findUnique({ where: { id: expenseId } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!expense) notFound();

  const serializedExpense = {
    ...expense,
    amount: expense.amount.toNumber(),
    date: expense.date.toISOString(),
  };

  return (
    <div className="space-y-6">
      <ExpenseForm expense={serializedExpense} categories={categories} />
      <div className="max-w-2xl flex justify-start">
        <DeleteExpenseButton expenseId={expenseId} />
      </div>
    </div>
  );
}
