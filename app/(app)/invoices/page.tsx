import { Suspense } from "react";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { InvoiceState } from "@prisma/client";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";
import { SortableColumn } from "@/components/ui/sortable-column";
import { Pagination } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { TableSkeleton } from "@/components/ui/table-skeleton";

const PAGE_SIZE = 25;

const stateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const stateVariants: Record<InvoiceState, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "secondary",
  Sent: "default",
  Paid: "outline",
  Overdue: "destructive",
  Canceled: "outline",
};

const filterOptions: { value: string; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "Paid", label: "Bezahlt" },
  { value: "Overdue", label: "Überfällig" },
  { value: "Canceled", label: "Storniert" },
];

type SortField = "documentNumber" | "date" | "dueDate" | "totalAmount" | "state";
type SortOrder = "asc" | "desc";

type TableProps = {
  activeFilter: string;
  term: string;
  customerId?: number;
  currentPage: number;
  sortField: SortField;
  sortOrder: SortOrder;
  baseHref: string;
  dateFrom?: string;
  dateTo?: string;
  sortHrefs: Record<SortField, string>;
};

async function InvoicesTable({
  activeFilter, term, customerId, currentPage, sortField, sortOrder, baseHref,
  dateFrom, dateTo, sortHrefs,
}: TableProps) {
  const dateFromDate = dateFrom ? new Date(dateFrom) : undefined;
  const dateToDate = dateTo ? new Date(dateTo + "T23:59:59") : undefined;

  const where = {
    ...(customerId ? { customerId } : {}),
    ...(activeFilter !== "all" ? { state: activeFilter as InvoiceState } : {}),
    ...(dateFromDate || dateToDate
      ? { date: { ...(dateFromDate ? { gte: dateFromDate } : {}), ...(dateToDate ? { lte: dateToDate } : {}) } }
      : {}),
    ...(term
      ? {
          OR: [
            { documentNumber: { contains: term } },
            { customer: { company: { contains: term } } },
            { customer: { contactPerson: { contains: term } } },
          ],
        }
      : {}),
  };

  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      include: { customer: true },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableColumn href={sortHrefs.documentNumber} active={sortField === "documentNumber"} direction={sortOrder}>
                  Nummer
                </SortableColumn>
              </TableHead>
              <TableHead>Kunde</TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.date} active={sortField === "date"} direction={sortOrder}>
                  Datum
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.dueDate} active={sortField === "dueDate"} direction={sortOrder}>
                  Fälligkeit
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.totalAmount} active={sortField === "totalAmount"} direction={sortOrder}>
                  Betrag
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.state} active={sortField === "state"} direction={sortOrder}>
                  Status
                </SortableColumn>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  {term || activeFilter !== "all" || dateFrom || dateTo ? (
                    <p className="text-muted-foreground">Keine Rechnungen für diese Filterkriterien.</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-muted-foreground">Noch keine Rechnungen erfasst.</p>
                      <Button size="sm" render={<Link href="/invoices/new" />}>
                        Erste Rechnung erstellen
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">
                      {inv.documentNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/customers/${inv.customer.customerId}`} className="hover:underline">
                      {inv.customer.contactInsteadOfCompany
                        ? inv.customer.contactPerson
                        : (inv.customer.company || inv.customer.contactPerson)}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(inv.date)}</TableCell>
                  <TableCell>{formatDate(inv.dueDate)}</TableCell>
                  <TableCell>{formatCurrency(inv.totalAmount.toNumber())}</TableCell>
                  <TableCell>
                    <Badge variant={stateVariants[inv.state]}>{stateLabels[inv.state]}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        baseHref={baseHref}
      />
    </>
  );
}

function InvoicesTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nummer</TableHead>
            <TableHead>Kunde</TableHead>
            <TableHead>Datum</TableHead>
            <TableHead>Fälligkeit</TableHead>
            <TableHead>Betrag</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableSkeleton columns={6} />
      </Table>
    </div>
  );
}

type Props = {
  searchParams: Promise<{
    state?: string;
    search?: string;
    customerId?: string;
    page?: string;
    sortBy?: string;
    order?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
};

export default async function InvoicesPage({ searchParams }: Props) {
  const { state, search, customerId, page, sortBy, order, dateFrom, dateTo } = await searchParams;
  const customerFilter = customerId ? parseInt(customerId, 10) || undefined : undefined;
  const activeFilter = state ?? "all";
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const validSortFields: SortField[] = ["documentNumber", "date", "dueDate", "totalAmount", "state"];
  const sortField: SortField = validSortFields.includes(sortBy as SortField) ? (sortBy as SortField) : "date";
  const sortOrder: SortOrder = order === "asc" ? "asc" : "desc";
  const term = search?.trim() ?? "";

  const [pendingCount, reminderCount] = await Promise.all([
    prisma.pendingEmail.count(),
    prisma.pendingReminder.count(),
  ]);

  function sortHref(col: SortField) {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (customerFilter) p.set("customerId", String(customerFilter));
    if (activeFilter !== "all") p.set("state", activeFilter);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    p.set("sortBy", col);
    p.set("order", sortField === col && sortOrder === "desc" ? "asc" : "desc");
    return `/invoices?${p.toString()}`;
  }

  function filterHref(value: string) {
    const params = new URLSearchParams();
    if (value !== "all") params.set("state", value);
    if (term) params.set("search", term);
    if (customerFilter) params.set("customerId", String(customerFilter));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (sortField !== "date") params.set("sortBy", sortField);
    if (sortOrder !== "desc") params.set("order", sortOrder);
    return `/invoices${params.size ? "?" + params.toString() : ""}`;
  }

  const baseHref = (() => {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (customerFilter) p.set("customerId", String(customerFilter));
    if (activeFilter !== "all") p.set("state", activeFilter);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (sortField !== "date") p.set("sortBy", sortField);
    if (sortOrder !== "desc") p.set("order", sortOrder);
    return `/invoices${p.size ? "?" + p.toString() : ""}`;
  })();

  const sortHrefs: Record<SortField, string> = {
    documentNumber: sortHref("documentNumber"),
    date: sortHref("date"),
    dueDate: sortHref("dueDate"),
    totalAmount: sortHref("totalAmount"),
    state: sortHref("state"),
  };

  const exportHref = `/api/export/invoices${
    activeFilter !== "all" || dateFrom || dateTo
      ? "?" + new URLSearchParams({
          ...(activeFilter !== "all" ? { state: activeFilter } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }).toString()
      : ""
  }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-semibold">Rechnungen</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton href={exportHref} />
          <Button variant="outline" size="sm" render={<Link href="/invoices/templates" />}>
            Vorlagen
          </Button>
          <Button render={<Link href="/invoices/new" />}>Neue Rechnung</Button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30 px-4 py-3">
          <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
            {pendingCount === 1
              ? "1 Jahresrechnung wartet auf Prüfung und Versand."
              : `${pendingCount} Jahresrechnungen warten auf Prüfung und Versand.`}
          </p>
          <Button size="sm" render={<Link href="/invoices/pending" />}>Jetzt prüfen</Button>
        </div>
      )}

      {reminderCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 px-4 py-3">
          <p className="text-sm font-medium text-orange-900 dark:text-orange-200">
            {reminderCount === 1
              ? "1 überfällige Rechnung wartet auf Mahnung."
              : `${reminderCount} überfällige Rechnungen warten auf Mahnung.`}
          </p>
          <Button size="sm" render={<Link href="/invoices/reminders" />}>Jetzt prüfen</Button>
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        {filterOptions.map((opt) => (
          <Link
            key={opt.value}
            href={filterHref(opt.value)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors",
              activeFilter === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <Suspense fallback={<div className="h-9 rounded-lg border border-input bg-muted animate-pulse" />}>
        <SearchInput defaultValue={search ?? ""} placeholder="Rechnung oder Kunde suchen…" />
      </Suspense>

      <Suspense fallback={null}>
        <DateRangeFilter />
      </Suspense>

      <Suspense fallback={<InvoicesTableSkeleton />}>
        <InvoicesTable
          activeFilter={activeFilter}
          term={term}
          customerId={customerFilter}
          currentPage={currentPage}
          sortField={sortField}
          sortOrder={sortOrder}
          baseHref={baseHref}
          dateFrom={dateFrom}
          dateTo={dateTo}
          sortHrefs={sortHrefs}
        />
      </Suspense>
    </div>
  );
}
