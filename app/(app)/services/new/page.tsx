import prisma from "@/lib/prisma";
import ServiceForm from "../ServiceForm";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

export default async function NewServicePage() {
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/services" backLabel="Zu den Leistungen" />;
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ServiceForm categories={categories} />;
}
