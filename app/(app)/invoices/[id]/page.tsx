import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import ItemsView from "@/components/items-view";
import InvoiceStatusSelect from "../InvoiceStatusSelect";
import DeleteInvoiceButton from "../DeleteInvoiceButton";
import SendInvoiceButton from "../SendInvoiceButton";
import SaveAsTemplateButton from "../SaveAsTemplateButton";
import CreateCreditNoteButton from "../CreateCreditNoteButton";
import { UserRole, type InvoiceState } from "@prisma/client";
import PaymentsPanel from "../PaymentsPanel";
import { toRappen } from "@/lib/calculations";
import { auth } from "@/lib/auth";
import { hasRole, isEditorSession } from "@/lib/permissions";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { documentLabel } from "@/lib/document-display";
import { reminderTitle } from "@/lib/reminder-charges";
import { billingEmail } from "@/lib/customer-billing";
import { loadModules } from "@/lib/module-guard";
import { customerDisplayName } from "@/lib/customer-display";
import { invoiceMail } from "@/lib/mail-templates";
import { generateInvoiceNumber } from "@/lib/document-number";
import { isLastReminderLevelSent, latestSentReminders, reminderAvailability } from "@/lib/reminders";
import { SendDialogProvider } from "../SendDialogContext";

const stateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  PartiallyPaid: "Teilbezahlt",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const stateVariants: Record<
  InvoiceState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Draft: "secondary",
  Sent: "default",
  PartiallyPaid: "secondary",
  Paid: "outline",
  Overdue: "destructive",
  Canceled: "outline",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function InvoiceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const invoiceId = parseInt(id, 10);

  const modules = await loadModules();
  const session = await auth();
  // Viewers only read: every action below is hidden for them (the actions check the role too).
  const canEdit = isEditorSession(session);
  const canDelete = session ? hasRole(session, [UserRole.Admin]) : false;

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        items: true,
        sentLogs: { orderBy: { sentAt: "desc" } },
        sentDocuments: { orderBy: { createdAt: "desc" } },
        payments: { orderBy: [{ date: "asc" }, { id: "asc" }] },
        creditNoteFor: { select: { id: true, documentNumber: true } },
        pendingReminder: { select: { id: true, invoiceId: true, reminderLevel: true, snoozedUntil: true, createdAt: true } },
        creditNotes: {
          where: { state: { not: "Draft" } },
          orderBy: { date: "asc" },
          select: { id: true, documentNumber: true, date: true, totalAmount: true },
        },
      },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!invoice) notFound();

  const totalRappen = toRappen(invoice.totalAmount);
  const paidRappen = invoice.payments.reduce((sum, p) => sum + toRappen(p.amount), 0);
  const isCreditNote = invoice.creditNoteForId !== null;
  const creditedRappen = invoice.creditNotes.reduce((sum, c) => sum + Math.abs(toRappen(c.totalAmount)), 0);
  const summary = {
    total: totalRappen / 100,
    paid: paidRappen / 100,
    remaining: Math.max(totalRappen - creditedRappen - paidRappen, 0) / 100,
    overpaid: Math.max(paidRappen + creditedRappen - totalRappen, 0) / 100,
  };

  // The server refuses further credit notes once the sent ones cover the total.
  const fullyCredited = totalRappen > 0 && creditedRappen >= totalRappen;

  const fromCustomer = from?.startsWith("customers/") ? from : null;
  const backHref = fromCustomer ? `/${fromCustomer}` : "/invoices";
  const customerName = customerDisplayName(invoice.customer);
  const breadcrumbItems = fromCustomer
    ? [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${fromCustomer}` }, { label: documentLabel(invoice.documentNumber) }]
    : [{ label: "Rechnungen", href: "/invoices" }, { label: documentLabel(invoice.documentNumber) }];

  const companyName = settings?.companyInfo.companyName ?? "";
  // Drafts have no number yet: the placeholder stays so it is filled in when sent.
  const { subject: defaultSubject, body: defaultBody } = invoiceMail(invoice, settings, companyName);

  // Read-only preview for the status confirmation and the send dialog (credit notes share the invoice
  // series); the real number is assigned on the change.
  const nextDocumentNumber =
    canEdit && invoice.state === "Draft" ? await generateInvoiceNumber() : null;

  const pending = invoice.pendingReminder;
  const reminder =
    canEdit && modules.reminders
      ? reminderAvailability({
          state: invoice.state,
          dueDate: invoice.dueDate,
          isCreditNote,
          pendingReminder: pending,
          lastLevelSent: pending ? await isLastReminderLevelSent(prisma, pending) : false,
        })
      : ({ kind: "none" } as const);
  // Newest notice of the current reminder (same source and cut-off as the Mahnungen list).
  const lastSentReminder = pending ? (await latestSentReminders(prisma, [pending])).get(invoice.id) : undefined;
  const lastSentText = lastSentReminder
    ? `Letzte Mahnung: ${reminderTitle(lastSentReminder.level)} (Stufe ${lastSentReminder.level}) am ${formatDate(lastSentReminder.sentAt)}.`
    : "";
  const reminderHint: string | null = (() => {
    switch (reminder.kind) {
      case "available":
        return invoice.state === "PartiallyPaid"
          ? `Teilzahlung erhalten: Gemahnt wird der offene Restbetrag von ${formatCurrency(summary.remaining)}. ${lastSentText}`.trim()
          : null;
      case "snoozed":
        return `${reminderTitle(reminder.level)} wieder möglich ab ${formatDate(reminder.until)} (zuletzt versendet oder zurückgestellt). ${lastSentText}`.trim();
      case "lastLevelSent":
        return `Letzte Mahnstufe versendet, die App sendet keine weitere Mahnung. ${lastSentText}`.trim();
      case "awaitingJob":
        return "Überfällig: Die Mahnung wird beim nächsten täglichen Abgleich vorbereitet und erscheint dann unter «Mahnungen».";
      default:
        return null;
    }
  })();

  return (
    <SendDialogProvider>
    <div className="space-y-4">
      <Breadcrumb items={breadcrumbItems} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            {isCreditNote ? "Gutschrift " : ""}{documentLabel(invoice.documentNumber)}
          </h1>
          {invoice.creditNoteFor && (
            <p className="text-sm text-gray-500">
              Zu Rechnung{" "}
              <Link href={`/invoices/${invoice.creditNoteFor.id}`} className="hover:underline">
                {documentLabel(invoice.creditNoteFor.documentNumber)}
              </Link>
            </p>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            <Link
              href={`/customers/${invoice.customer.customerId}`}
              className="hover:underline"
            >
              {customerDisplayName(invoice.customer)}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={stateVariants[invoice.state]}>
            {stateLabels[invoice.state]}
          </Badge>
          <Button variant="outline" size="sm" render={<Link href={backHref} />}>
            Zurück
          </Button>
          {canEdit && invoice.state === "Draft" && (
            <Button
              size="sm"
              render={<Link href={`/invoices/${invoice.id}/edit${fromCustomer ? `?from=${fromCustomer}` : ""}`} />}
            >
              Bearbeiten
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="text-gray-500">Datum:</span>{" "}
              {formatDate(invoice.date)}
            </div>
            {!isCreditNote && (
              <div>
                <span className="text-gray-500">Fällig am:</span>{" "}
                {formatDate(invoice.dueDate)}
              </div>
            )}
            <div>
              <span className="text-gray-500">Betrag:</span>{" "}
              <span className="font-medium">
                {formatCurrency(invoice.totalAmount.toNumber())}
              </span>
            </div>
          </div>
          {invoice.customUserText && (
            <div>
              <span className="text-gray-500">Zusatztext:</span>
              <p className="mt-1 whitespace-pre-wrap">{invoice.customUserText}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Positionen</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemsView
            items={invoice.items.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity.toNumber(),
              unitPrice: item.unitPrice.toNumber(),
              totalAmount: item.totalAmount.toNumber(),
              discountPercent: item.discountPercent.toNumber(),
            }))}
          />
          <div className="flex justify-end mt-3">
            <div className="text-right text-sm space-y-1">
              {invoice.discountPercent.toNumber() > 0 && (
                <p className="text-muted-foreground">Gesamtrabatt: {invoice.discountPercent.toNumber()}%</p>
              )}
              <p className="font-semibold">Total: {formatCurrency(invoice.totalAmount.toNumber())}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {invoice.sentLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Versandhistorie</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Empfänger</TableHead>
                    <TableHead>Betreff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.sentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(log.sentAt)}{" "}
                        <span className="text-xs text-gray-500">
                          {log.sentAt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </TableCell>
                      <TableCell>{log.sentTo}</TableCell>
                      <TableCell className="text-sm text-gray-600">{log.subject}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {canEdit && invoice.sentDocuments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Versendete Dokumente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Art</TableHead>
                    <TableHead>Empfänger</TableHead>
                    <TableHead>Prüfsumme (SHA-256)</TableHead>
                    <TableHead>PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.sentDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(doc.createdAt)}</TableCell>
                      <TableCell>
                        {doc.kind === "Reminder" ? reminderTitle(doc.reminderLevel ?? 1) : isCreditNote ? "Gutschrift" : "Rechnung"}
                      </TableCell>
                      <TableCell>{doc.sentTo}</TableCell>
                      <TableCell className="font-mono text-xs" title={doc.sha256}>
                        {doc.sha256.slice(0, 12)}…
                      </TableCell>
                      <TableCell>
                        <a
                          href={`/api/invoices/${invoice.id}/archive/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          Öffnen
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {invoice.creditNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Gutschriften</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nummer</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.creditNotes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/invoices/${c.id}`} className="hover:underline">
                          {documentLabel(c.documentNumber)}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(c.date)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(c.totalAmount.toNumber())}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-right text-sm font-semibold">
              Offener Betrag: {formatCurrency(summary.remaining)}
            </p>
          </CardContent>
        </Card>
      )}

      {!isCreditNote && invoice.state !== "Draft" && invoice.state !== "Canceled" && (
        <Card>
          <CardHeader>
            <CardTitle>Zahlungen</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentsPanel
              key={`${invoice.payments.length}-${summary.remaining}`}
              invoiceId={invoice.id}
              state={invoice.state}
              canEdit={canEdit}
              summary={summary}
              payments={invoice.payments.map((p) => ({
                id: p.id,
                date: p.date.toISOString(),
                amount: p.amount.toNumber(),
                source: p.source,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Viewers see the status only as the badge in the header. */}
      {canEdit && !isCreditNote && (
        <Card>
          <CardHeader>
            <CardTitle>Status ändern</CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-4 flex-wrap">
            <InvoiceStatusSelect
              invoiceId={invoice.id}
              currentState={invoice.state}
              nextDocumentNumber={nextDocumentNumber}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center flex-wrap gap-2">
        {canDelete && invoice.state === "Draft" ? (
          <DeleteInvoiceButton invoiceId={invoice.id} isCreditNote={isCreditNote} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {/* A fully credited invoice is not sent again (the server refuses it too); credit notes stay sendable. */}
          {canEdit && (isCreditNote || invoice.state !== "Canceled") && (
            <SendInvoiceButton
              invoiceId={invoice.id}
              customerEmail={billingEmail(invoice.customer)}
              documentNumber={invoice.documentNumber}
              defaultSubject={defaultSubject}
              defaultBody={defaultBody}
              isCreditNote={isCreditNote}
              expectedDocumentNumber={nextDocumentNumber}
              variant={!isCreditNote && invoice.state === "Paid" ? "outline" : "default"}
            />
          )}
          {reminder.kind === "available" && pending && (
            <Button
              variant="outline"
              title={lastSentText || undefined}
              render={
                <Link
                  href={`/invoices/reminders?search=${encodeURIComponent(invoice.documentNumber ?? "")}#reminder-${pending.id}`}
                />
              }
            >
              {reminderTitle(reminder.level)} senden
            </Button>
          )}
          {canEdit && !isCreditNote && invoice.state !== "Draft" && invoice.state !== "Canceled" && !fullyCredited && (
            <CreateCreditNoteButton invoiceId={invoice.id} paid={summary.paid} remaining={summary.remaining} />
          )}
          {canEdit && !isCreditNote && <SaveAsTemplateButton invoiceId={invoice.id} />}
          <Button
            variant="outline"
            render={<Link href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
          >
            PDF herunterladen
          </Button>
        </div>
      </div>
      {reminderHint && <p className="text-sm text-muted-foreground text-right">{reminderHint}</p>}
    </div>
    </SendDialogProvider>
  );
}
