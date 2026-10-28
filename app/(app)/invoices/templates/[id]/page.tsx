import prisma from "@/lib/prisma";
import { loadUnitOrder } from "@/lib/unit-usage";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import TemplateEditForm from "./TemplateEditForm";
import type { ItemData } from "@/components/items-editor-schema";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: Props) {
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/invoices" backLabel="Zu den Rechnungen" />;
  const { id } = await params;
  const templateId = parseInt(id, 10);

    const [template, services, categories, unitOrder] = await Promise.all([
    prisma.invoiceTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { id: "asc" } } },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
    loadUnitOrder(prisma),
  ]);

  if (!template) notFound();

  const initialItems: ItemData[] = template.items.map((item) => ({
    name: item.name,
    description: item.description ?? "",
    unit: item.unit,
    unitPrice: Number(item.unitPrice),
    quantity: Number(item.quantity),
    discountPercent: 0,
    totalAmount: Number(item.unitPrice) * Number(item.quantity),
    customText: "",
    categoryId: item.categoryId,
  }));

  return (
    <div className="max-w-3xl space-y-4">
      <Breadcrumb
        items={[
          { label: "Rechnungsvorlagen", href: "/invoices/templates" },
          { label: template.name },
        ]}
      />
      <TemplateEditForm
        templateId={templateId}
        name={template.name}
        initialItems={initialItems}
        services={services}
          categories={categories}
        unitOrder={unitOrder}
      />
    </div>
  );
}
