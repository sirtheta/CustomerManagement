import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { CategoryManagement } from "./CategoryManagement";

export default async function CategoriesPage() {
  await requireAdmin();
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kategorien</h1>
        <p className="text-muted-foreground mt-1">
          Kategorien für Rechnungspositionen, Leistungen und Ausgaben verwalten.
        </p>
      </div>
      <CategoryManagement categories={categories} />
    </div>
  );
}
