import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { requireEditor } from "@/lib/permissions";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import TemplateEditForm from "./TemplateEditForm";
import type { ItemData } from "@/components/items-editor-schema";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TemplateEditPage({ params }: Props) {
  await requireEditor();
  const { id } = await params;
  const templateId = parseInt(id, 10);

  const [template, services] = await Promise.all([
    prisma.invoiceTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { id: "asc" } } },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
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
          { label: "Vorlagen", href: "/invoices/templates" },
          { label: template.name },
        ]}
      />
      <TemplateEditForm
        templateId={templateId}
        name={template.name}
        initialItems={initialItems}
        services={services}
      />
    </div>
  );
}
