import prisma from "@/lib/prisma";
import ExpenseForm from "../ExpenseForm";

export default async function NewExpensePage() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ExpenseForm categories={categories} />;
}
