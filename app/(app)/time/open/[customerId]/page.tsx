import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModule } from "@/lib/module-guard";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { Button } from "@/components/ui/button";
import { customerDisplayName } from "@/lib/customer-display";
import { CUSTOMER_ARCHIVED_ERROR } from "@/lib/customer-archive";
import { loadTotalOptions } from "@/lib/total-options";
import type { BillableService } from "@/lib/work-billing";
import BillForm from "./BillForm";

export default async function BillPage({ params }: { params: Promise<{ customerId: string }> }) {
  await requireModule("timeTracking");
  const session = await auth();
  if (!isEditorSession(session)) return <EditorOnlyNotice />;

  const customerId = Number((await params).customerId);
  if (!Number.isInteger(customerId)) notFound();
  const customer = await prisma.customer.findUnique({ where: { customerId } });
  if (!customer) notFound();

  const entries = await prisma.workEntry.findMany({
    where: { customerId, invoiceId: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const serviceIds = [...new Set(entries.flatMap((e) => (e.serviceId === null ? [] : [e.serviceId])))];
  const serviceRows = await prisma.service.findMany({ where: { id: { in: serviceIds } } });
  const services: Record<number, BillableService> = Object.fromEntries(
    serviceRows.map((s) => [
      s.id,
      { name: s.name, description: s.description, unit: s.unit, unitPrice: Number(s.unitPrice), categoryId: s.categoryId },
    ])
  );
  const { roundTo5Rappen } = await loadTotalOptions();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Verrechnen: {customerDisplayName(customer)}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Einträge auswählen und daraus einen Rechnungsentwurf erstellen. Im Entwurf lässt sich alles anpassen.
        </p>
      </div>
      {customer.archivedAt && <p className="rounded-lg border p-3 text-sm text-destructive">{CUSTOMER_ARCHIVED_ERROR}</p>}
      {entries.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Für diesen Kunden gibt es keine offenen Einträge.</p>
          <Button variant="outline" size="sm" render={<Link href="/time/open" />}>
            Zu den offenen Erfassungen
          </Button>
        </div>
      ) : (
        <BillForm
          customerId={customerId}
          canBill={!customer.archivedAt}
          roundTo5Rappen={roundTo5Rappen ?? false}
          services={services}
          entries={entries.map((e) => ({
            id: e.id,
            date: e.date.toISOString().slice(0, 10),
            serviceId: e.serviceId,
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
