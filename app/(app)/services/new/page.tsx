import prisma from "@/lib/prisma";
import { loadUnitOrder } from "@/lib/unit-usage";
import ServiceForm from "../ServiceForm";
import { isEditorSession, requireSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

export default async function NewServicePage() {
  if (!isEditorSession(await requireSession())) return <EditorOnlyNotice backHref="/services" backLabel="Zu den Leistungen" />;
  const [categories, unitOrder] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    loadUnitOrder(prisma),
  ]);

  return <ServiceForm categories={categories} unitOrder={unitOrder} />;
}
