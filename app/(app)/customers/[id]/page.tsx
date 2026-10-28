import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import CustomerForm from "../CustomerForm";
import DeleteCustomerButton from "../DeleteCustomerButton";
import ArchiveCustomerButton from "../ArchiveCustomerButton";
import DocumentsSection from "../DocumentsSection";
import NotesSection from "../NotesSection";
import SubscriptionsSection from "../SubscriptionsSection";
import ContactsSection from "../ContactsSection";
import TasksSection from "../TasksSection";
import HistorySection from "../HistorySection";
import { loadCustomerHistory } from "@/lib/customer-history";
import { toDateString } from "@/lib/date";
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
import { UserRole } from "@prisma/client";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { auth } from "@/lib/auth";
import { hasRole, isEditorSession } from "@/lib/permissions";
import {
  invoiceStateLabels,
  invoiceStateVariants,
  quoteStateLabels,
  quoteStateVariants,
} from "@/lib/document-states";
import { decryptSecret } from "@/lib/crypto";
import { documentLabel } from "@/lib/document-display";
import { loadModules } from "@/lib/module-guard";
import { customerDisplayName } from "@/lib/customer-display";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function CustomerDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { edit } = await searchParams;
  const customerId = parseInt(id, 10);

  const session = await auth();
  const canEdit = isEditorSession(session);
  const canDelete = session ? hasRole(session, [UserRole.Admin]) : false;
  const isEditing = edit === "true" && canEdit;

  const DETAIL_LIST_LIMIT = 25;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const modules = await loadModules();

  const [customer, documents, notes, invoices, quotes, invoiceCount, quoteCount, subscriptions, templates, contacts, tasks, users, history] = await Promise.all([
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
    modules.quotes
      ? prisma.quote.findMany({
          where: { customerId },
          orderBy: { date: "desc" },
          take: DETAIL_LIST_LIMIT,
        })
      : [],
    prisma.invoice.count({ where: { customerId } }),
    modules.quotes ? prisma.quote.count({ where: { customerId } }) : 0,
    modules.subscriptions
      ? prisma.subscription.findMany({
          where: { customerId },
          include: { template: { select: { name: true } } },
          orderBy: { nextInvoiceDate: "asc" },
        })
      : [],
    modules.subscriptions
      ? prisma.invoiceTemplate.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
    prisma.customerContact.findMany({ where: { customerId }, orderBy: [{ createdAt: "asc" }, { contactId: "asc" }] }),
    modules.tasks
      ? prisma.task.findMany({
          where: { customerId },
          include: { assignee: { select: { name: true } } },
          orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        })
      : [],
    modules.tasks
      ? prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
    loadCustomerHistory(prisma, customerId, { quotes: modules.quotes, tasks: modules.tasks }),
  ]);
  const workEntryCount = await prisma.workEntry.count({ where: { customerId } });

  if (!customer) notFound();

  const decryptedNotes = notes.map((n) => ({ ...n, content: decryptSecret(n.content) }));

  const customerName = customerDisplayName(customer);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          customer.archivedAt
            ? { label: "Archivierte Kunden", href: "/customers?archived=true" }
            : { label: "Kunden", href: "/customers" },
          { label: customerName },
        ]}
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{customerName}</h1>
          {customer.archivedAt && <Badge variant="outline">Archiviert</Badge>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            {!customer.archivedAt && (
              <>
                <Button size="sm" render={<Link href={`/invoices/new?customerId=${customerId}`} />}>
                  Neue Rechnung
                </Button>
                {modules.quotes && (
                  <Button size="sm" variant="outline" render={<Link href={`/quotes/new?customerId=${customerId}`} />}>
                    Neue Offerte
                  </Button>
                )}
              </>
            )}
            <ArchiveCustomerButton
              customerId={customerId}
              archived={customer.archivedAt !== null}
              activeSubscriptions={subscriptions.filter((s) => s.active).length}
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <CustomerForm
            key={`${customer.customerId}-${isEditing}`}
            customer={customer}
            readOnly={!isEditing}
            cancelHref={`/customers/${customerId}`}
            editHref={!isEditing && canEdit ? `/customers/${customerId}?edit=true` : undefined}
          />
          <ContactsSection
            customerId={customerId}
            canEdit={canEdit}
            contacts={contacts.map((c) => ({
              contactId: c.contactId,
              name: c.name,
              role: c.role,
              email: c.email,
              phone: c.phone,
            }))}
          />
          {modules.subscriptions && (
            <SubscriptionsSection
              customerId={customerId}
              canEdit={canEdit}
              templates={templates}
              subscriptions={subscriptions.map((s) => ({
                id: s.id,
                interval: s.interval,
                nextInvoiceDate: toDateString(s.nextInvoiceDate),
                autoSend: s.autoSend,
                active: s.active,
                templateId: s.templateId,
                templateName: s.template?.name ?? null,
              }))}
            />
          )}
        </div>
        <div className="space-y-6">
          {modules.tasks && (
            <TasksSection
              customerId={customerId}
              canEdit={canEdit}
              users={users}
              tasks={tasks.map((t) => ({
                id: t.id,
                title: t.title,
                dueDate: toDateString(t.dueDate),
                overdue: t.dueDate < startOfToday,
                done: t.doneAt !== null,
                assigneeName: t.assignee?.name ?? null,
              }))}
            />
          )}
          <DocumentsSection customerId={customerId} documents={documents} canEdit={canEdit} canDelete={canDelete} />
          <NotesSection customerId={customerId} notes={decryptedNotes} canEdit={canEdit} canDelete={canDelete} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rechnungen</CardTitle>
          {canEdit && (
            <Button size="sm" render={<Link href={`/invoices/new?customerId=${customerId}`} />}>
              Neue Rechnung
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {invoices.length > 0 && (
            // Phones get cards: amount and status stay visible without sideways scrolling
            <ul className="space-y-3 md:hidden">
              {invoices.map((inv) => (
                <li key={inv.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/invoices/${inv.id}?from=customers/${customerId}`} className="font-medium hover:underline">
                      {documentLabel(inv.documentNumber)}
                      {inv.creditNoteForId !== null && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">Gutschrift</span>
                      )}
                    </Link>
                    <Badge variant={invoiceStateVariants[inv.state]}>{invoiceStateLabels[inv.state]}</Badge>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-sm text-muted-foreground">
                    <span>
                      {formatDate(inv.date)}
                      {inv.creditNoteForId === null && ` · fällig ${formatDate(inv.dueDate)}`}
                    </span>
                    <span className="font-semibold text-foreground">{formatCurrency(inv.totalAmount.toNumber())}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className={invoices.length > 0 ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>
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
                        {canEdit && (
                          <Button size="sm" render={<Link href={`/invoices/new?customerId=${customerId}`} />}>
                            Neue Rechnung erstellen
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">
                        <Link href={`/invoices/${inv.id}?from=customers/${customerId}`} className="hover:underline">
                          {documentLabel(inv.documentNumber)}
                        </Link>
                        {inv.creditNoteForId !== null && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">Gutschrift</span>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(inv.date)}</TableCell>
                      <TableCell>{inv.creditNoteForId !== null ? "" : formatDate(inv.dueDate)}</TableCell>
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

      {modules.quotes && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Offerten</CardTitle>
            {canEdit && (
              <Button size="sm" render={<Link href={`/quotes/new?customerId=${customerId}`} />}>
                Neue Offerte
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {quotes.length > 0 && (
              <ul className="space-y-3 md:hidden">
                {quotes.map((q) => (
                  <li key={q.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/quotes/${q.id}?from=customers/${customerId}`} className="font-medium hover:underline">
                        {documentLabel(q.documentNumber)}
                      </Link>
                      <Badge variant={quoteStateVariants[q.state]}>{quoteStateLabels[q.state]}</Badge>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between text-sm text-muted-foreground">
                      <span>
                        {formatDate(q.date)} · gültig bis {formatDate(q.validUntil)}
                      </span>
                      <span className="font-semibold text-foreground">{formatCurrency(q.totalAmount.toNumber())}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className={quotes.length > 0 ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>
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
                          {canEdit && (
                            <Button size="sm" render={<Link href={`/quotes/new?customerId=${customerId}`} />}>
                              Neue Offerte erstellen
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    quotes.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="font-medium">
                          <Link href={`/quotes/${q.id}?from=customers/${customerId}`} className="hover:underline">
                            {documentLabel(q.documentNumber)}
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
      )}
      </div>

      <HistorySection events={history} />

      {canDelete && (
        <div className="flex justify-start">
          <DeleteCustomerButton
            customerId={customerId}
            hasInvoices={invoiceCount > 0}
            hasWorkEntries={workEntryCount > 0}
            activeSubscriptions={subscriptions.filter((s) => s.active).length}
            archived={customer.archivedAt !== null}
          />
        </div>
      )}
    </div>
  );
}
