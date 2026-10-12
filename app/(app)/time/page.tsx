import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireModule } from "@/lib/module-guard";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { selectableCustomersWhere } from "@/lib/customer-archive";
import { swissDateString } from "@/lib/date";
import { MATERIAL_UNITS, TIME_UNITS, pickRecentServiceIds } from "@/lib/work-entries";
import TimeEntryForm from "./TimeEntryForm";
import WorkEntryList from "./WorkEntryList";

export default async function TimePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requireModule("timeTracking");
  const session = await auth();
  if (!isEditorSession(session)) return <EditorOnlyNotice />;

  const { customer: customerParam } = await searchParams;
  const [customers, services, lastEntry, lastTimeEntry, recentMaterial] = await Promise.all([
    prisma.customer.findMany({
      where: selectableCustomersWhere(),
      orderBy: [{ company: "asc" }, { contactPerson: "asc" }],
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true, category: { select: { name: true } } },
    }),
    prisma.workEntry.findFirst({ orderBy: { id: "desc" }, select: { customerId: true } }),
    prisma.workEntry.findFirst({
      where: { unit: { in: [...TIME_UNITS] }, serviceId: { not: null } },
      orderBy: { id: "desc" },
      select: { serviceId: true },
    }),
    prisma.workEntry.findMany({
      where: { unit: { in: [...MATERIAL_UNITS] }, serviceId: { not: null } },
      orderBy: { id: "desc" },
      take: 50,
      select: { serviceId: true },
    }),
  ]);
  const materialServices = services
    .filter((s) => (MATERIAL_UNITS as readonly string[]).includes(s.unit))
    .map((s) => ({ id: s.id, name: s.name, unit: s.unit, category: s.category?.name ?? null }));
  const recentMaterialIds = pickRecentServiceIds(
    recentMaterial.map((e) => e.serviceId),
    new Set(materialServices.map((s) => s.id)),
  );

  const selectable = new Set(customers.map((c) => c.customerId));
  // Without a parameter the customer of the last entry is preselected. With one (`?customer=none`
  // after the picker was cleared) only that choice counts, so an emptied picker never books on a
  // customer the form does not show.
  const customerId =
    customerParam === undefined
      ? lastEntry && selectable.has(lastEntry.customerId)
        ? lastEntry.customerId
        : null
      : selectable.has(Number(customerParam))
        ? Number(customerParam)
        : null;

  const entries =
    customerId === null
      ? []
      : await prisma.workEntry.findMany({
          where: { customerId, invoiceId: null },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: 30,
        });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Zeiterfassung</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Zeit und Material für einen Kunden erfassen.</p>
      </div>
      <TimeEntryForm
        customers={customers}
        customerId={customerId}
        timeServices={services.filter((s) => (TIME_UNITS as readonly string[]).includes(s.unit))}
        materialServices={materialServices}
        recentMaterialIds={recentMaterialIds}
        defaultTimeServiceId={lastTimeEntry?.serviceId ?? null}
        today={swissDateString()}
      />
      {customerId !== null && (
        <WorkEntryList
          entries={entries.map((e) => ({
            id: e.id,
            date: e.date.toISOString().slice(0, 10),
            name: e.name,
            unit: e.unit,
            quantity: Number(e.quantity),
            note: e.note,
          }))}
        />
      )}
    </div>
  );
}
