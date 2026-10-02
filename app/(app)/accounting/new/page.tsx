import prisma from "@/lib/prisma";
import ExpenseForm from "../ExpenseForm";
import { requireModule } from "@/lib/module-guard";
import { requireEditor } from "@/lib/permissions";

export default async function NewExpensePage() {
  await requireEditor();
  await requireModule("accounting");
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ExpenseForm categories={categories} />;
}
