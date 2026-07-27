import prisma from "@/lib/prisma";
import InvoiceForm from "../InvoiceForm";

type Props = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewInvoicePage({ searchParams }: Props) {
  const { customerId } = await searchParams;
  const defaultCustomerId = customerId ? parseInt(customerId, 10) || undefined : undefined;

  const [customers, services, settings, templates] = await Promise.all([
    prisma.customer.findMany({ orderBy: { contactPerson: "asc" } }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
    prisma.invoiceTemplate.findMany({
      include: { items: { orderBy: { id: "asc" } } },
      orderBy: { name: "asc" },
    }).then(rows => rows.map(t => ({
      ...t,
      items: t.items.map(i => ({ ...i, unitPrice: Number(i.unitPrice), quantity: Number(i.quantity) })),
    }))),
  ]);

  return (
    <InvoiceForm
      customers={customers}
      services={services}
      defaultPaymentTermDays={settings?.defaultPaymentTermDays ?? 30}
      templates={templates}
      defaultCustomerId={defaultCustomerId}
    />
  );
}
