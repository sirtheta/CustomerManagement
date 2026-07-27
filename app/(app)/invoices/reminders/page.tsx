import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import ReminderRow from "./ReminderRow";
import { SearchInput } from "@/components/search-input";
import { Suspense } from "react";

type Props = {
  searchParams: Promise<{ search?: string }>;
};

export default async function RemindersPage({ searchParams }: Props) {
  const { search } = await searchParams;
  const term = search?.trim() ?? "";
  const now = new Date();

  const snoozedFilter = {
    OR: [
      { snoozedUntil: null },
      { snoozedUntil: { lte: now } },
    ],
  };

  const searchFilter = term
    ? {
        OR: [
          { invoice: { documentNumber: { contains: term } } },
          { invoice: { customer: { company: { contains: term } } } },
          { invoice: { customer: { contactPerson: { contains: term } } } },
        ],
      }
    : undefined;

  const [reminders, settings] = await Promise.all([
    prisma.pendingReminder.findMany({
      include: {
        invoice: { include: { customer: true } },
      },
      where: {
        AND: [snoozedFilter, ...(searchFilter ? [searchFilter] : [])],
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  const companyName = settings?.companyInfo.companyName ?? "";

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ausstehende Mahnungen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Überfällige Rechnungen prüfen und Mahnungen versenden
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          Zurück
        </Button>
      </div>

      <Suspense fallback={<div className="h-9 rounded-lg border border-input bg-muted animate-pulse" />}>
        <SearchInput defaultValue={search ?? ""} placeholder="Rechnung oder Kunde suchen…" />
      </Suspense>

      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {term ? "Keine Mahnungen für diesen Suchbegriff." : "Keine ausstehenden Mahnungen."}
        </p>
      ) : (
        <div className="space-y-4">
          {reminders.map((r) => {
            const inv = r.invoice;
            const c = inv.customer;
            const customerName = c.contactInsteadOfCompany
              ? c.contactPerson
              : (c.company || c.contactPerson);

            const levelLabel = r.reminderLevel === 1
              ? "Zahlungserinnerung"
              : r.reminderLevel === 2
              ? "1. Mahnung"
              : "2. Mahnung";

            const defaultSubject = `${levelLabel}: Rechnung ${inv.documentNumber} – ${companyName}`;
            const defaultBody = `Guten Tag ${c.contactPerson}\n\nwir möchten Sie höflich daran erinnern, dass folgende Rechnung noch offen ist:\n\nRechnung Nr.: ${inv.documentNumber}\nBetrag: ${formatCurrency(inv.totalAmount.toNumber())}\nFälligkeitsdatum: ${formatDate(inv.dueDate)}\n\nBitte überweisen Sie den Betrag umgehend auf unser Konto.\n\nMit freundlichen Grüssen\n${companyName}`;

            return (
              <ReminderRow
                key={r.id}
                reminderId={r.id}
                invoiceId={inv.id}
                documentNumber={inv.documentNumber}
                customerName={customerName}
                totalAmount={inv.totalAmount.toNumber()}
                dueDate={formatDate(inv.dueDate)}
                customerEmail={c.email}
                reminderLevel={r.reminderLevel}
                defaultSubject={defaultSubject}
                defaultBody={defaultBody}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
