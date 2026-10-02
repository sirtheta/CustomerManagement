import prisma from "@/lib/prisma";
import { selectableCustomersWhere } from "@/lib/customer-archive";
import QuoteForm from "../QuoteForm";
import { requireModule } from "@/lib/module-guard";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";

type Props = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewQuotePage({ searchParams }: Props) {
  await requireModule("quotes");
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/quotes" backLabel="Zu den Offerten" />;
  const { customerId } = await searchParams;
  const defaultCustomerId = customerId ? parseInt(customerId, 10) || undefined : undefined;

    const [customers, services, settings, categories] = await Promise.all([
    prisma.customer.findMany({
      where: defaultCustomerId !== undefined ? selectableCustomersWhere(defaultCustomerId) : { archivedAt: null },
      orderBy: { contactPerson: "asc" },
    }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }).then(rows =>
      rows.map(s => ({ ...s, unitPrice: Number(s.unitPrice) }))
    ),
    prisma.applicationSettings.findFirst(),
      prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <QuoteForm
      customers={customers}
      services={services}
      defaultQuoteValidityDays={settings?.defaultQuoteValidityDays ?? 30}
      defaultCustomerId={defaultCustomerId}
        categories={categories}
    />
  );
}
