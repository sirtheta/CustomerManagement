import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import ReminderRow from "./ReminderRow";
import { SearchInput } from "@/components/search-input";
import { Suspense } from "react";
import { getPaymentSummary } from "@/lib/payments";
import { documentLabel } from "@/lib/document-display";
import { computeReminderCharges, reminderTitle } from "@/lib/reminder-charges";
import { isLastReminderLevelSent } from "@/lib/reminders";
import { billingEmail } from "@/lib/customer-billing";
import { requireModule } from "@/lib/module-guard";

type Props = {
  searchParams: Promise<{ search?: string }>;
};

export default async function RemindersPage({ searchParams }: Props) {
  await requireModule("reminders");
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
  // Open amount after payments and sent credit notes (not the invoice total).
  const remainingByInvoice = new Map(
    await Promise.all(
      reminders.map(async (r) => [r.invoiceId, (await getPaymentSummary(r.invoiceId)).remainingRappen / 100] as const)
    )
  );
  const lastLevelSentIds = new Set(
    (
      await Promise.all(
        reminders.map(async (r) => ((await isLastReminderLevelSent(prisma, r)) ? r.id : null))
      )
    ).filter((id): id is number => id !== null)
  );

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

            const levelLabel = reminderTitle(r.reminderLevel);
            const remaining = remainingByInvoice.get(inv.id) ?? inv.totalAmount.toNumber();
            const remainingRappen = Math.round(remaining * 100);
            const charges = settings
              ? computeReminderCharges({
                  level: r.reminderLevel,
                  openRappen: remainingRappen,
                  dueDate: inv.dueDate,
                  dunningDate: now,
                  settings,
                })
              : null;
            const extra = charges && (charges.feeRappen > 0 || charges.interestRappen > 0)
              ? `\nMahngebühr: ${formatCurrency(charges.feeRappen / 100)}\nVerzugszins: ${formatCurrency(charges.interestRappen / 100)}\nTotal: ${formatCurrency(charges.totalRappen / 100)}`
              : "";
            const defaultSubject = `${levelLabel}: Rechnung ${documentLabel(inv.documentNumber)} – ${companyName}`;
            const defaultBody = `Guten Tag ${c.contactPerson}\n\nwir möchten Sie höflich daran erinnern, dass folgende Rechnung noch offen ist:\n\nRechnung Nr.: ${documentLabel(inv.documentNumber)}\nBetrag: ${formatCurrency(remaining)}${extra}\nFälligkeitsdatum: ${formatDate(inv.dueDate)}\n\nBitte überweisen Sie den Betrag umgehend auf unser Konto.\n\nMit freundlichen Grüssen\n${companyName}`;

            return (
              <ReminderRow
                key={r.id}
                reminderId={r.id}
                invoiceId={inv.id}
                documentNumber={inv.documentNumber}
                customerName={customerName}
                totalAmount={remaining}
                dueDate={formatDate(inv.dueDate)}
                customerEmail={billingEmail(c)}
                reminderLevel={r.reminderLevel}
                defaultSubject={defaultSubject}
                defaultBody={defaultBody}
                feeRappen={charges?.feeRappen ?? 0}
                interestRappen={charges?.interestRappen ?? 0}
                lastLevelSent={lastLevelSentIds.has(r.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
