import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import ServiceForm from "../ServiceForm";
import DeleteServiceButton from "../DeleteServiceButton";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditServicePage({ params }: Props) {
  const { id } = await params;
  const serviceId = parseInt(id, 10);

  const [service, categories] = await Promise.all([
    prisma.service.findUnique({ where: { id: serviceId } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!service) notFound();

  const serializedService = {
    ...service,
    unitPrice: service.unitPrice.toNumber(),
  };

  return (
    <div className="space-y-6">
      <ServiceForm service={serializedService} categories={categories} />
      <div className="max-w-2xl flex justify-start">
        <DeleteServiceButton serviceId={serviceId} />
      </div>
    </div>
  );
}
