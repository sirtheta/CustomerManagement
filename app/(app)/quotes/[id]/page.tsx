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
import QuoteStatusSelect from "../QuoteStatusSelect";
import DeleteQuoteButton from "../DeleteQuoteButton";
import ConvertToInvoiceButton from "../ConvertToInvoiceButton";
import SendQuoteButton from "../SendQuoteButton";
import type { QuoteState } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

const stateLabels: Record<QuoteState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Accepted: "Angenommen",
  Declined: "Abgelehnt",
  Expired: "Abgelaufen",
};

const stateVariants: Record<
  QuoteState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Draft: "secondary",
  Sent: "default",
  Accepted: "outline",
  Declined: "destructive",
  Expired: "outline",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const quoteId = parseInt(id, 10);

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, items: true, sentLogs: { orderBy: { sentAt: "desc" } } },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!quote) notFound();

  const companyName = settings?.companyInfo.companyName ?? "";
  const defaultSubject = `Offerte Nr. ${quote.documentNumber} – ${companyName}`;
  const defaultBody = `Guten Tag ${quote.customer.contactPerson}\n\nanbei erhalten Sie die Offerte Nr. ${quote.documentNumber} vom ${formatDate(quote.date)} über ${formatCurrency(quote.totalAmount.toNumber())}.\n${quote.customUserText ? `\n${quote.customUserText}\n` : ""}\nGültig bis: ${formatDate(quote.validUntil)}\n\nMit freundlichen Grüssen\n${companyName}`;

  const fromCustomer = from?.startsWith("customers/") ? from : null;
  const backHref = fromCustomer ? `/${fromCustomer}` : "/quotes";
  const customerName = quote.customer.contactInsteadOfCompany
    ? quote.customer.contactPerson
    : (quote.customer.company || quote.customer.contactPerson);
  const breadcrumbItems = fromCustomer
    ? [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${fromCustomer}` }, { label: quote.documentNumber }]
    : [{ label: "Offerten", href: "/quotes" }, { label: quote.documentNumber }];

  return (
    <div className="max-w-3xl space-y-4">
      <Breadcrumb items={breadcrumbItems} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{quote.documentNumber}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <Link
              href={`/customers/${quote.customer.customerId}`}
              className="hover:underline"
            >
              {quote.customer.contactInsteadOfCompany
                ? quote.customer.contactPerson
                : (quote.customer.company || quote.customer.contactPerson)}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={stateVariants[quote.state]}>
            {stateLabels[quote.state]}
          </Badge>
          <Button variant="outline" size="sm" render={<Link href={backHref} />}>
            Zurück
          </Button>
          <Button
            size="sm"
            render={<Link href={`/quotes/${quote.id}/edit${fromCustomer ? `?from=${fromCustomer}` : ""}`} />}
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
              {formatDate(quote.date)}
            </div>
            <div>
              <span className="text-gray-500">Gültig bis:</span>{" "}
              {formatDate(quote.validUntil)}
            </div>
            <div>
              <span className="text-gray-500">Betrag:</span>{" "}
              <span className="font-medium">
                {formatCurrency(quote.totalAmount.toNumber())}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Version:</span> {quote.version}
            </div>
          </div>
          {quote.customUserText && (
            <div>
              <span className="text-gray-500">Zusatztext:</span>
              <p className="mt-1 whitespace-pre-wrap">{quote.customUserText}</p>
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
            items={quote.items.map((item) => ({
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
              Total: {formatCurrency(quote.totalAmount.toNumber())}
            </p>
          </div>
        </CardContent>
      </Card>

      {quote.sentLogs.length > 0 && (
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
                  {quote.sentLogs.map((log) => (
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
        <CardContent>
          <QuoteStatusSelect quoteId={quote.id} currentState={quote.state} />
        </CardContent>
      </Card>

      <div className="flex justify-between items-center flex-wrap gap-2">
        <DeleteQuoteButton quoteId={quote.id} />
        <div className="flex items-center gap-2 flex-wrap">
          <SendQuoteButton
            quoteId={quote.id}
            customerEmail={quote.customer.email}
            documentNumber={quote.documentNumber}
            defaultSubject={defaultSubject}
            defaultBody={defaultBody}
          />
          <ConvertToInvoiceButton quoteId={quote.id} />
          <Button
            variant="outline"
            render={<Link href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
          >
            PDF herunterladen
          </Button>
        </div>
      </div>
    </div>
  );
}
