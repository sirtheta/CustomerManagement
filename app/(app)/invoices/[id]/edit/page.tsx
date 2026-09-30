import prisma from "@/lib/prisma";
import { selectableCustomersWhere } from "@/lib/customer-archive";
import { notFound, redirect } from "next/navigation";
import InvoiceForm from "../../InvoiceForm";
import { serializeInvoiceForForm } from "@/lib/invoice-form";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function EditInvoicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const invoiceId = parseInt(id, 10);

    const [invoice, services, settings, categories] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!invoice) notFound();
  if (invoice.state !== "Draft") redirect(`/invoices/${invoice.id}`);

  const customers = await prisma.customer.findMany({
    where: selectableCustomersWhere(invoice.customerId),
    orderBy: { contactPerson: "asc" },
  });

  const original = invoice.creditNoteForId !== null
    ? await prisma.invoice.findUnique({
        where: { id: invoice.creditNoteForId },
        select: { id: true, documentNumber: true },
      })
    : null;
  const serializedInvoice = serializeInvoiceForForm(invoice);

  return (
    <InvoiceForm
      invoice={serializedInvoice}
      customers={customers}
      services={services}
      defaultPaymentTermDays={settings?.defaultPaymentTermDays ?? 30}
      from={from?.startsWith("customers/") ? from : undefined}
        categories={categories}
      creditNoteFor={original ?? undefined}
    />
  );
}
