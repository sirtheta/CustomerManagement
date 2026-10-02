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
import { toRappen } from "@/lib/payments";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { documentLabel } from "@/lib/document-display";
import { reminderTitle } from "@/lib/reminder-charges";
import { billingEmail } from "@/lib/customer-billing";
import { loadModules } from "@/lib/module-guard";

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
  const canEdit = session ? hasRole(session, [UserRole.Admin, UserRole.Editor]) : false;

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
        pendingReminder: { select: { reminderLevel: true, snoozedUntil: true } },
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

  const fromCustomer = from?.startsWith("customers/") ? from : null;
  const backHref = fromCustomer ? `/${fromCustomer}` : "/invoices";
  const customerName = invoice.customer.contactInsteadOfCompany
    ? invoice.customer.contactPerson
    : (invoice.customer.company || invoice.customer.contactPerson);
  const breadcrumbItems = fromCustomer
    ? [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${fromCustomer}` }, { label: documentLabel(invoice.documentNumber) }]
    : [{ label: "Rechnungen", href: "/invoices" }, { label: documentLabel(invoice.documentNumber) }];

  const companyName = settings?.companyInfo.companyName ?? "";
  // Drafts have no number yet: keep the placeholder so it is filled in when sent.
  const numberOrPlaceholder = invoice.documentNumber ?? "{documentNumber}";
  const invoiceSubject =
    settings?.emailSubjectTemplate?.replace(/\{documentNumber\}/g, numberOrPlaceholder).replace(/\{companyName\}/g, companyName)
    ?? `Rechnung Nr. ${numberOrPlaceholder} – ${companyName}`;
  const defaultSubject = isCreditNote
    ? `Gutschrift Nr. ${numberOrPlaceholder} – ${companyName}`
    : invoiceSubject;
  const DEFAULT_BODY = `Guten Tag ${invoice.customer.contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. ${numberOrPlaceholder} vom ${formatDate(invoice.date)} über ${formatCurrency(invoice.totalAmount.toNumber())}.\n${invoice.customUserText ? `\n${invoice.customUserText}\n` : ""}\nZahlbar bis: ${formatDate(invoice.dueDate)}\n\nMit freundlichen Grüssen\n${companyName}`;
  const invoiceBody = settings?.emailBodyTemplate
    ? settings.emailBodyTemplate
        .replace(/\{documentNumber\}/g, numberOrPlaceholder)
        .replace(/\{contactPerson\}/g, invoice.customer.contactPerson)
        .replace(/\{companyName\}/g, companyName)
        .replace(/\{totalAmount\}/g, formatCurrency(invoice.totalAmount.toNumber()))
        .replace(/\{date\}/g, formatDate(invoice.date))
        .replace(/\{dueDate\}/g, formatDate(invoice.dueDate))
        .replace(/\{customUserText\}/g, invoice.customUserText ?? "")
    : DEFAULT_BODY;
  const defaultBody = isCreditNote
    ? `Guten Tag ${invoice.customer.contactPerson}\n\nanbei erhalten Sie die Gutschrift Nr. ${numberOrPlaceholder} vom ${formatDate(invoice.date)} über ${formatCurrency(Math.abs(invoice.totalAmount.toNumber()))}.\n\nMit freundlichen Grüssen\n${companyName}`
    : invoiceBody;

  return (
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
              {invoice.customer.contactInsteadOfCompany
                ? invoice.customer.contactPerson
                : (invoice.customer.company || invoice.customer.contactPerson)}
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
            <div>
              <span className="text-gray-500">Version:</span> {invoice.version}
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
                        {doc.kind === "Reminder" ? reminderTitle(doc.reminderLevel ?? 1) : "Rechnung"}
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

      {!isCreditNote && (
        <Card>
          <CardHeader>
            <CardTitle>Status ändern</CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-4 flex-wrap">
            <InvoiceStatusSelect
              invoiceId={invoice.id}
              currentState={invoice.state}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center flex-wrap gap-2">
        {invoice.state === "Draft" ? <DeleteInvoiceButton invoiceId={invoice.id} isCreditNote={isCreditNote} /> : <span />}
        <div className="flex items-center gap-2 flex-wrap">
          <SendInvoiceButton
            invoiceId={invoice.id}
            customerEmail={billingEmail(invoice.customer)}
            documentNumber={invoice.documentNumber}
            defaultSubject={defaultSubject}
            defaultBody={defaultBody}
            isCreditNote={isCreditNote}
          />
          {canEdit && modules.reminders && invoice.pendingReminder && (
            <Button
              variant="outline"
              render={<Link href={`/invoices/reminders?search=${encodeURIComponent(invoice.documentNumber ?? "")}`} />}
            >
              {reminderTitle(invoice.pendingReminder.reminderLevel)} senden
            </Button>
          )}
          {canEdit && !isCreditNote && invoice.state !== "Draft" && invoice.state !== "Canceled" && (
            <CreateCreditNoteButton invoiceId={invoice.id} />
          )}
          {!isCreditNote && <SaveAsTemplateButton invoiceId={invoice.id} />}
          <Button
            variant="outline"
            render={<Link href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
          >
            PDF herunterladen
          </Button>
        </div>
      </div>
    </div>
  );
}
