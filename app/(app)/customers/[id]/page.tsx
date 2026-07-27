import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import CustomerForm from "../CustomerForm";
import DeleteCustomerButton from "../DeleteCustomerButton";
import DocumentsSection from "../DocumentsSection";
import NotesSection from "../NotesSection";
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
import { InvoiceState, QuoteState, UserRole } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { auth } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";

const invoiceStateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const invoiceStateVariants: Record<
  InvoiceState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Draft: "secondary",
  Sent: "default",
  Paid: "outline",
  Overdue: "destructive",
  Canceled: "outline",
};

const quoteStateLabels: Record<QuoteState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Accepted: "Angenommen",
  Declined: "Abgelehnt",
  Expired: "Abgelaufen",
};

const quoteStateVariants: Record<
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
  searchParams: Promise<{ edit?: string }>;
};

export default async function CustomerDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { edit } = await searchParams;
  const customerId = parseInt(id, 10);

  const session = await auth();
  const canEdit = session?.user.role === UserRole.Admin || session?.user.role === UserRole.Editor;
  const canDelete = session?.user.role === UserRole.Admin;
  const isEditing = edit === "true" && canEdit;

  const DETAIL_LIST_LIMIT = 25;

  const [customer, documents, notes, invoices, quotes, invoiceCount, quoteCount] = await Promise.all([
    prisma.customer.findUnique({ where: { customerId } }),
    prisma.document.findMany({
      where: { customerId },
      select: {
        documentId: true,
        name: true,
        fileType: true,
        uploadDate: true,
        note: true,
      },
      orderBy: { uploadDate: "desc" },
    }),
    prisma.customerNote.findMany({
      where: { customerId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { customerId },
      orderBy: { date: "desc" },
      take: DETAIL_LIST_LIMIT,
    }),
    prisma.quote.findMany({
      where: { customerId },
      orderBy: { date: "desc" },
      take: DETAIL_LIST_LIMIT,
    }),
    prisma.invoice.count({ where: { customerId } }),
    prisma.quote.count({ where: { customerId } }),
  ]);

  if (!customer) notFound();

  const decryptedNotes = notes.map((n) => ({ ...n, content: decryptSecret(n.content) }));

  const customerName = customer.contactInsteadOfCompany
    ? customer.contactPerson
    : (customer.company || customer.contactPerson);

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Kunden", href: "/customers" }, { label: customerName }]} />
      <h1 className="text-2xl font-semibold">{customerName}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <CustomerForm
          customer={customer}
          readOnly={!isEditing}
          cancelHref={`/customers/${customerId}`}
          editHref={!isEditing && canEdit ? `/customers/${customerId}?edit=true` : undefined}
        />
        <div className="space-y-6">
          <DocumentsSection customerId={customerId} documents={documents} />
          <NotesSection customerId={customerId} notes={decryptedNotes} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rechnungen</CardTitle>
          <Button size="sm" render={<Link href={`/invoices/new?customerId=${customerId}`} />}>
            Neue Rechnung
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Fälligkeit</TableHead>
                  <TableHead>Betrag</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <div className="space-y-3">
                        <p className="text-muted-foreground">Noch keine Rechnungen vorhanden.</p>
                        <Button size="sm" render={<Link href={`/invoices/new?customerId=${customerId}`} />}>
                          Neue Rechnung erstellen
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">
                        <Link href={`/invoices/${inv.id}?from=customers/${customerId}`} className="hover:underline">
                          {inv.documentNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(inv.date)}</TableCell>
                      <TableCell>{formatDate(inv.dueDate)}</TableCell>
                      <TableCell>{formatCurrency(inv.totalAmount.toNumber())}</TableCell>
                      <TableCell>
                        <Badge variant={invoiceStateVariants[inv.state]}>
                          {invoiceStateLabels[inv.state]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {invoiceCount > invoices.length && (
            <div className="pt-3 text-center">
              <Link
                href={`/invoices?customerId=${customerId}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                Alle {invoiceCount} Rechnungen anzeigen
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Offerten</CardTitle>
          <Button size="sm" render={<Link href={`/quotes/new?customerId=${customerId}`} />}>
            Neue Offerte
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Gültig bis</TableHead>
                  <TableHead>Betrag</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <div className="space-y-3">
                        <p className="text-muted-foreground">Noch keine Offerten vorhanden.</p>
                        <Button size="sm" render={<Link href={`/quotes/new?customerId=${customerId}`} />}>
                          Neue Offerte erstellen
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  quotes.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-medium">
                        <Link href={`/quotes/${q.id}?from=customers/${customerId}`} className="hover:underline">
                          {q.documentNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(q.date)}</TableCell>
                      <TableCell>{formatDate(q.validUntil)}</TableCell>
                      <TableCell>{formatCurrency(q.totalAmount.toNumber())}</TableCell>
                      <TableCell>
                        <Badge variant={quoteStateVariants[q.state]}>
                          {quoteStateLabels[q.state]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {quoteCount > quotes.length && (
            <div className="pt-3 text-center">
              <Link
                href={`/quotes?customerId=${customerId}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                Alle {quoteCount} Offerten anzeigen
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {canDelete && (
        <div className="flex justify-start">
          <DeleteCustomerButton customerId={customerId} />
        </div>
      )}
    </div>
  );
}
