import prisma from "@/lib/prisma";
import { firstProfileLabel } from "@/lib/sender-profile";
import { loadUnitOrder } from "@/lib/unit-usage";
import { selectableCustomersWhere } from "@/lib/customer-archive";
import InvoiceForm from "../InvoiceForm";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

type Props = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewInvoicePage({ searchParams }: Props) {
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/invoices" backLabel="Zu den Rechnungen" />;
  const { customerId } = await searchParams;
  const defaultCustomerId = customerId ? parseInt(customerId, 10) || undefined : undefined;

    const [customers, services, settings, templates, categories, unitOrder, senderProfiles] = await Promise.all([
    prisma.customer.findMany({
      where: defaultCustomerId !== undefined ? selectableCustomersWhere(defaultCustomerId) : { archivedAt: null },
      orderBy: { contactPerson: "asc" },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
    prisma.invoiceTemplate.findMany({
      include: { items: { orderBy: { id: "asc" } } },
      orderBy: { name: "asc" },
    }).then(rows => rows.map(t => ({
      ...t,
      items: t.items.map(i => ({ ...i, unitPrice: Number(i.unitPrice), quantity: Number(i.quantity), discountPercent: 0 })),
    }))),
      prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    loadUnitOrder(prisma),
    prisma.senderProfile.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <InvoiceForm
      customers={customers}
      services={services}
      defaultPaymentTermDays={settings?.defaultPaymentTermDays ?? 30}
      templates={templates}
      defaultCustomerId={defaultCustomerId}
        categories={categories}
      unitOrder={unitOrder}
      roundTo5Rappen={settings?.roundTotalTo5Rappen ?? false}
      firstSenderLabel={firstProfileLabel(settings?.companyInfo.companyName)}
      senderProfiles={senderProfiles.filter((p) => p.isActive)}
    />
  );
}
