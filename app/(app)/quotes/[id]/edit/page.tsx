import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import QuoteForm from "../../QuoteForm";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function EditQuotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const quoteId = parseInt(id, 10);

  const [quote, customers, services, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    }),
    prisma.customer.findMany({ orderBy: { contactPerson: "asc" } }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
  ]);

  if (!quote) notFound();

  const serializedQuote = {
    ...quote,
    totalAmount: quote.totalAmount.toNumber(),
    items: quote.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      quantity: item.quantity.toNumber(),
      totalAmount: item.totalAmount.toNumber(),
    })),
  };

  return (
    <QuoteForm
      quote={serializedQuote}
      customers={customers}
      services={services}
      defaultQuoteValidityDays={settings?.defaultQuoteValidityDays ?? 30}
      from={from?.startsWith("customers/") ? from : undefined}
    />
  );
}
