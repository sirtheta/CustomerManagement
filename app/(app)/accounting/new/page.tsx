import prisma from "@/lib/prisma";
import ExpenseForm from "../ExpenseForm";
import { requireModule } from "@/lib/module-guard";

export default async function NewExpensePage() {
  await requireModule("accounting");
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ExpenseForm categories={categories} />;
}
