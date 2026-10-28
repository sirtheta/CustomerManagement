import prisma from "@/lib/prisma";
import { senderDisplayName } from "@/lib/sender-profile";
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
import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import ItemsView from "@/components/items-view";
import QuoteStatusSelect from "../QuoteStatusSelect";
import DeleteQuoteButton from "../DeleteQuoteButton";
import ConvertToInvoiceButton from "../ConvertToInvoiceButton";
import SendQuoteButton from "../SendQuoteButton";
import type { QuoteState } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { documentLabel } from "@/lib/document-display";
import { requireModule } from "@/lib/module-guard";
import { customerDisplayName } from "@/lib/customer-display";
import { quoteMail } from "@/lib/mail-templates";
import { generateQuoteNumber } from "@/lib/document-number";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { hasRole, isEditorSession } from "@/lib/permissions";

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
  await requireModule("quotes");
  const session = await auth();
  const canEdit = isEditorSession(session);
  const canDelete = session ? hasRole(session, [UserRole.Admin]) : false;
  const { id } = await params;
  const { from } = await searchParams;
  const quoteId = parseInt(id, 10);

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: true,
        senderProfile: { select: { name: true, companyName: true } },
        items: true,
        sentLogs: { orderBy: { sentAt: "desc" } },
        invoices: { select: { id: true, documentNumber: true }, orderBy: { id: "asc" } },
      },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!quote) notFound();

  const companyName = senderDisplayName(settings?.companyInfo ?? {}, quote.senderProfile);
  // Drafts have no number yet: the placeholder stays so it is filled in when sent.
  const { subject: defaultSubject, body: defaultBody } = quoteMail(quote, companyName);

  // Read-only preview for the send dialog; the real number is assigned when sending.
  const nextDocumentNumber = canEdit && !quote.documentNumber ? await generateQuoteNumber() : null;

  const fromCustomer = from?.startsWith("customers/") ? from : null;
  const customerName = customerDisplayName(quote.customer);
  const breadcrumbItems = fromCustomer
    ? [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${fromCustomer}` }, { label: documentLabel(quote.documentNumber) }]
    : [{ label: "Offerten", href: "/quotes" }, { label: documentLabel(quote.documentNumber) }];

  return (
    <div className="space-y-4">
      <Breadcrumb items={breadcrumbItems} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{documentLabel(quote.documentNumber)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            <Link
              href={`/customers/${quote.customer.customerId}`}
              className="hover:underline"
            >
              {customerDisplayName(quote.customer)}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={stateVariants[quote.state]}>
            {stateLabels[quote.state]}
          </Badge>
          {canEdit && (
            <Button
              size="sm"
              variant={quote.state === "Accepted" ? "outline" : "default"}
              render={<Link href={`/quotes/${quote.id}/edit${fromCustomer ? `?from=${fromCustomer}` : ""}`} />}
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
              <span className="text-muted-foreground">Datum:</span>{" "}
              {formatDate(quote.date)}
            </div>
            <div>
              <span className="text-muted-foreground">Gültig bis:</span>{" "}
              {formatDate(quote.validUntil)}
            </div>
            <div>
              <span className="text-muted-foreground">Betrag:</span>{" "}
              <span className="font-medium">
                {formatCurrency(quote.totalAmount.toNumber())}
              </span>
            </div>
            {quote.senderProfile && (
              <div>
                <span className="text-muted-foreground">Absender:</span> {quote.senderProfile.name}
              </div>
            )}
          </div>
          {quote.customUserText && (
            <div>
              <span className="text-muted-foreground">Zusatztext:</span>
              <p className="mt-1 whitespace-pre-wrap">{quote.customUserText}</p>
            </div>
          )}
          {quote.closingText && (
            <div>
              <span className="text-muted-foreground">Schlusstext:</span>
              <p className="mt-1 whitespace-pre-wrap">{quote.closingText}</p>
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
              discountPercent: item.discountPercent.toNumber(),
            }))}
          />
          <div className="flex justify-end mt-3">
            <div className="text-right text-sm space-y-1">
              {quote.discountPercent.toNumber() > 0 && (
                <p className="text-muted-foreground">Gesamtrabatt: {quote.discountPercent.toNumber()}%</p>
              )}
              <p className="font-semibold">Total: {formatCurrency(quote.totalAmount.toNumber())}</p>
            </div>
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
                        <span className="text-xs text-muted-foreground">
                          {formatTime(log.sentAt)}
                        </span>
                      </TableCell>
                      <TableCell>{log.sentTo}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{log.subject}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {quote.invoices.length > 0 && (
        <p className="text-sm">
          Umgewandelt in Rechnung{quote.invoices.length > 1 ? "en" : ""}{" "}
          {quote.invoices.map((invoice, i) => (
            <span key={invoice.id}>
              {i > 0 && ", "}
              <Link href={`/invoices/${invoice.id}`} className="font-medium underline">
                {documentLabel(invoice.documentNumber)}
              </Link>
            </span>
          ))}{" "}
          →
        </p>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Status ändern</CardTitle>
          </CardHeader>
          <CardContent>
            <QuoteStatusSelect quoteId={quote.id} currentState={quote.state} />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center flex-wrap gap-2">
        {canDelete ? <DeleteQuoteButton quoteId={quote.id} /> : <span />}
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <SendQuoteButton
              quoteId={quote.id}
              customerEmail={quote.customer.email}
              documentNumber={quote.documentNumber}
              defaultSubject={defaultSubject}
              defaultBody={defaultBody}
              expectedDocumentNumber={nextDocumentNumber}
              variant={quote.state === "Accepted" ? "outline" : "default"}
            />
          )}
          {canEdit && (
            <ConvertToInvoiceButton quoteId={quote.id} primary={quote.state === "Accepted" && quote.invoices.length === 0} alreadyConverted={quote.invoices.length > 0} />
          )}
          <Button
            variant="outline"
            render={<Link href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener noreferrer" />}
          >
            PDF ansehen
          </Button>
        </div>
      </div>
    </div>
  );
}
