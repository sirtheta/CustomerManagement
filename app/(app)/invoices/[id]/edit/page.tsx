import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import InvoiceForm from "../../InvoiceForm";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function EditInvoicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const invoiceId = parseInt(id, 10);

  const [invoice, customers, services, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    }),
    prisma.customer.findMany({ orderBy: { contactPerson: "asc" } }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
  ]);

  if (!invoice) notFound();

  const serializedInvoice = {
    ...invoice,
    totalAmount: invoice.totalAmount.toNumber(),
    discountPercent: invoice.discountPercent.toNumber(),
    items: invoice.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      quantity: item.quantity.toNumber(),
      discountPercent: item.discountPercent.toNumber(),
      totalAmount: item.totalAmount.toNumber(),
    })),
  };

  return (
    <InvoiceForm
      invoice={serializedInvoice}
      customers={customers}
      services={services}
      defaultPaymentTermDays={settings?.defaultPaymentTermDays ?? 30}
      from={from?.startsWith("customers/") ? from : undefined}
    />
  );
}
