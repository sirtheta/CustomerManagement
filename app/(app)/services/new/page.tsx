import prisma from "@/lib/prisma";
import ServiceForm from "../ServiceForm";

export default async function NewServicePage() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return <ServiceForm categories={categories} />;
}
