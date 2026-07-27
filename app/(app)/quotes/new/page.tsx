import prisma from "@/lib/prisma";
import QuoteForm from "../QuoteForm";

type Props = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewQuotePage({ searchParams }: Props) {
  const { customerId } = await searchParams;
  const defaultCustomerId = customerId ? parseInt(customerId, 10) || undefined : undefined;

  const [customers, services, settings] = await Promise.all([
    prisma.customer.findMany({ orderBy: { contactPerson: "asc" } }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
  ]);

  return (
    <QuoteForm
      customers={customers}
      services={services}
      defaultQuoteValidityDays={settings?.defaultQuoteValidityDays ?? 30}
      defaultCustomerId={defaultCustomerId}
    />
  );
}
