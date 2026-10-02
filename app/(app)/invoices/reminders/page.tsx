import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import ReminderRow from "./ReminderRow";
import { ReminderHighlight } from "./ReminderHighlight";
import { SearchInput } from "@/components/search-input";
import { Suspense } from "react";
import { getPaymentSummary } from "@/lib/payments";
import { documentLabel } from "@/lib/document-display";
import { computeReminderCharges, reminderTitle } from "@/lib/reminder-charges";
import { DEFAULT_REMINDER_COOLDOWN_DAYS, lastLevelSentReminderIds, latestSentReminders } from "@/lib/reminders";
import { billingEmail } from "@/lib/customer-billing";
import { requireModule } from "@/lib/module-guard";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { customerDisplayName } from "@/lib/customer-display";
import { reminderMail } from "@/lib/mail-templates";

type Props = {
  searchParams: Promise<{ search?: string }>;
};

export default async function RemindersPage({ searchParams }: Props) {
  await requireModule("reminders");
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/invoices" backLabel="Zu den Rechnungen" />;
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

  const [reminders, snoozed, settings] = await Promise.all([
    prisma.pendingReminder.findMany({
      include: {
        invoice: { include: { customer: true } },
      },
      where: {
        AND: [snoozedFilter, ...(searchFilter ? [searchFilter] : [])],
      },
      orderBy: { createdAt: "asc" },
    }),
    // Snoozed ones are hidden from the list; named here so a search for one (e.g. from
    // the invoice page) does not just end in an empty list.
    prisma.pendingReminder.findMany({
      where: { AND: [{ snoozedUntil: { gt: now } }, ...(searchFilter ? [searchFilter] : [])] },
      select: { id: true, snoozedUntil: true, invoice: { select: { documentNumber: true } } },
      orderBy: { snoozedUntil: "asc" },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  const companyName = settings?.companyInfo.companyName ?? "";
  const cooldownDays = settings?.reminderCooldownDays ?? DEFAULT_REMINDER_COOLDOWN_DAYS;
  const lastSent = await latestSentReminders(prisma, reminders);
  // Open amount after payments and sent credit notes (not the invoice total).
  const remainingByInvoice = new Map(
    await Promise.all(
      reminders.map(async (r) => [r.invoiceId, (await getPaymentSummary(r.invoiceId)).remainingRappen / 100] as const)
    )
  );
  const lastLevelSentIds = await lastLevelSentReminderIds(prisma, reminders);

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

      {snoozed.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {term
            ? `Zurückgestellt und darum ausgeblendet: ${snoozed
                .map((s) => `${documentLabel(s.invoice.documentNumber)} bis ${formatDate(s.snoozedUntil!)}`)
                .join(", ")}.`
            : `${snoozed.length} ${snoozed.length === 1 ? "Mahnung ist" : "Mahnungen sind"} zurückgestellt und ausgeblendet.`}{" "}
          Nach dem Versand oder Zurückstellen erscheint eine Mahnung nach {cooldownDays} Tagen wieder.
        </p>
      )}

      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {term ? "Keine fälligen Mahnungen für diesen Suchbegriff." : "Keine ausstehenden Mahnungen."}
        </p>
      ) : (
        <div className="space-y-4">
          {reminders.map((r) => {
            const inv = r.invoice;
            const c = inv.customer;
            const customerName = customerDisplayName(c);

            const sent = lastSent.get(inv.id);
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
            const { subject: defaultSubject, body: defaultBody } = reminderMail({
              level: r.reminderLevel,
              numberLabel: documentLabel(inv.documentNumber),
              contactPerson: c.contactPerson,
              companyName,
              dueDate: inv.dueDate,
              openAmount: remaining,
              charges,
            });

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
                lastSent={sent ? { level: sent.level, title: reminderTitle(sent.level), date: formatDate(sent.sentAt) } : null}
                cooldownDays={cooldownDays}
              />
            );
          })}
          <ReminderHighlight />
        </div>
      )}
    </div>
  );
}
