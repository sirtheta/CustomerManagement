import prisma from "@/lib/prisma";
import ExpenseForm from "../ExpenseForm";
import { requireModule } from "@/lib/module-guard";
import { isEditorSession, requireSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

export default async function NewExpensePage() {
  await requireModule("accounting");
  if (!isEditorSession(await requireSession())) return <EditorOnlyNotice />;
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ExpenseForm categories={categories} />;
}
