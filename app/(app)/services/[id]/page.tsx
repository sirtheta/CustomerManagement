import prisma from "@/lib/prisma";
import { loadUnitOrder } from "@/lib/unit-usage";
import { notFound } from "next/navigation";
import ServiceForm from "../ServiceForm";
import DeleteServiceButton from "../DeleteServiceButton";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditServicePage({ params }: Props) {
  const { id } = await params;
  const serviceId = parseInt(id, 10);

  const [service, categories, unitOrder] = await Promise.all([
    prisma.service.findUnique({ where: { id: serviceId } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    loadUnitOrder(prisma),
  ]);

  if (!service) notFound();

  const serializedService = {
    ...service,
    unitPrice: service.unitPrice.toNumber(),
  };

  return (
    <div className="space-y-6">
      <ServiceForm service={serializedService} categories={categories} unitOrder={unitOrder} />
      <div className="max-w-2xl flex justify-start">
        <DeleteServiceButton serviceId={serviceId} />
      </div>
    </div>
  );
}
