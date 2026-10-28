import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { loadCategoryUsageTotals } from "@/lib/category-usage";
import { CategoryManagement } from "./CategoryManagement";

export default async function CategoriesPage() {
  await requireAdmin();
  const [categories, usageTotals] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    loadCategoryUsageTotals(prisma),
  ]);
  const rows = categories.map((category) => ({
    ...category,
    usageCount: usageTotals.get(category.categoryId) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Kategorien</h1>
        <p className="text-muted-foreground mt-1">
          Kategorien für Rechnungspositionen, Leistungen und Ausgaben verwalten.
        </p>
      </div>
      <CategoryManagement categories={rows} />
    </div>
  );
}
