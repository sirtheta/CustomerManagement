import prisma from "@/lib/prisma";
import { loadUnitOrder } from "@/lib/unit-usage";
import { notFound } from "next/navigation";
import ServiceForm from "../ServiceForm";
import DeleteServiceButton from "../DeleteServiceButton";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { hasRole, isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditServicePage({ params }: Props) {
  const session = await auth();
  if (!isEditorSession(session)) return <EditorOnlyNotice backHref="/services" backLabel="Zu den Leistungen" />;
  const canDelete = session ? hasRole(session, [UserRole.Admin]) : false;
  const { id } = await params;
  const serviceId = parseInt(id, 10);

  const [service, categories, unitOrder, openWorkEntries] = await Promise.all([
    prisma.service.findUnique({ where: { id: serviceId } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    loadUnitOrder(prisma),
    prisma.workEntry.count({ where: { serviceId, invoiceId: null } }),
  ]);

  if (!service) notFound();

  const serializedService = {
    ...service,
    unitPrice: service.unitPrice.toNumber(),
  };

  return (
    <div className="space-y-6">
      <ServiceForm service={serializedService} categories={categories} unitOrder={unitOrder} />
      {canDelete && (
        <div className="max-w-2xl flex justify-start">
          <DeleteServiceButton serviceId={serviceId} openWorkEntries={openWorkEntries} />
        </div>
      )}
    </div>
  );
}
