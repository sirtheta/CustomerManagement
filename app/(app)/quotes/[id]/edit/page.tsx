import prisma from "@/lib/prisma";
import { selectableCustomersWhere } from "@/lib/customer-archive";
import { notFound } from "next/navigation";
import QuoteForm from "../../QuoteForm";
import { requireModule } from "@/lib/module-guard";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function EditQuotePage({ params, searchParams }: Props) {
  await requireModule("quotes");
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/quotes" backLabel="Zu den Offerten" />;
  const { id } = await params;
  const { from } = await searchParams;
  const quoteId = parseInt(id, 10);

    const [quote, services, settings, categories] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!quote) notFound();

  const customers = await prisma.customer.findMany({
    where: selectableCustomersWhere(quote.customerId),
    orderBy: { contactPerson: "asc" },
  });

  const serializedQuote = {
    ...quote,
    totalAmount: quote.totalAmount.toNumber(),
    discountPercent: quote.discountPercent.toNumber(),
    items: quote.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      quantity: item.quantity.toNumber(),
      discountPercent: item.discountPercent.toNumber(),
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
        categories={categories}
    />
  );
}
