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
import PaidDateField from "../PaidDateField";
import DeleteInvoiceButton from "../DeleteInvoiceButton";
import SendInvoiceButton from "../SendInvoiceButton";
import SaveAsTemplateButton from "../SaveAsTemplateButton";
import type { InvoiceState } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const stateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
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

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, items: true, sentLogs: { orderBy: { sentAt: "desc" } } },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!invoice) notFound();

  const fromCustomer = from?.startsWith("customers/") ? from : null;
  const backHref = fromCustomer ? `/${fromCustomer}` : "/invoices";
  const customerName = invoice.customer.contactInsteadOfCompany
    ? invoice.customer.contactPerson
    : (invoice.customer.company || invoice.customer.contactPerson);
  const breadcrumbItems = fromCustomer
    ? [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${fromCustomer}` }, { label: invoice.documentNumber }]
    : [{ label: "Rechnungen", href: "/invoices" }, { label: invoice.documentNumber }];

  const companyName = settings?.companyInfo.companyName ?? "";
  const defaultSubject =
    settings?.emailSubjectTemplate?.replace(/\{documentNumber\}/g, invoice.documentNumber).replace(/\{companyName\}/g, companyName)
    ?? `Rechnung Nr. ${invoice.documentNumber} – ${companyName}`;
  const DEFAULT_BODY = `Guten Tag ${invoice.customer.contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. ${invoice.documentNumber} vom ${formatDate(invoice.date)} über ${formatCurrency(invoice.totalAmount.toNumber())}.\n${invoice.customUserText ? `\n${invoice.customUserText}\n` : ""}\nZahlbar bis: ${formatDate(invoice.dueDate)}\n\nMit freundlichen Grüssen\n${companyName}`;
  const defaultBody = settings?.emailBodyTemplate
    ? settings.emailBodyTemplate
        .replace(/\{documentNumber\}/g, invoice.documentNumber)
        .replace(/\{contactPerson\}/g, invoice.customer.contactPerson)
        .replace(/\{companyName\}/g, companyName)
        .replace(/\{totalAmount\}/g, formatCurrency(invoice.totalAmount.toNumber()))
        .replace(/\{date\}/g, formatDate(invoice.date))
        .replace(/\{dueDate\}/g, formatDate(invoice.dueDate))
        .replace(/\{customUserText\}/g, invoice.customUserText ?? "")
    : DEFAULT_BODY;

  return (
    <div className="max-w-3xl space-y-4">
      <Breadcrumb items={breadcrumbItems} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{invoice.documentNumber}</h1>
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
          <Button
            size="sm"
            render={<Link href={`/invoices/${invoice.id}/edit${fromCustomer ? `?from=${fromCustomer}` : ""}`} />}
          >
            Bearbeiten
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-500">Datum:</span>{" "}
              {formatDate(invoice.date)}
            </div>
            <div>
              <span className="text-gray-500">Fällig am:</span>{" "}
              {formatDate(invoice.dueDate)}
            </div>
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
            }))}
          />
          <div className="flex justify-end mt-3">
            <p className="text-sm font-semibold">
              Total: {formatCurrency(invoice.totalAmount.toNumber())}
            </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Status ändern</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-4 flex-wrap">
          <InvoiceStatusSelect
            invoiceId={invoice.id}
            currentState={invoice.state}
          />
          {invoice.state === "Paid" && (
            <PaidDateField
              invoiceId={invoice.id}
              paidDate={invoice.paidDate?.toISOString() ?? null}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center flex-wrap gap-2">
        <DeleteInvoiceButton invoiceId={invoice.id} />
        <div className="flex items-center gap-2 flex-wrap">
          <SendInvoiceButton
            invoiceId={invoice.id}
            customerEmail={invoice.customer.email}
            documentNumber={invoice.documentNumber}
            defaultSubject={defaultSubject}
            defaultBody={defaultBody}
          />
          <SaveAsTemplateButton invoiceId={invoice.id} />
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
