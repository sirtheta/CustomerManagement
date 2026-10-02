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
import { InvoiceState, type Prisma } from "@prisma/client";
import { invoiceStateFilter } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";
import { SortableColumn } from "@/components/ui/sortable-column";
import { Pagination } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { documentLabel } from "@/lib/document-display";
import { loadModules } from "@/lib/module-guard";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { attentionBanners, loadAttentionCounts } from "@/lib/attention-counts";
import { AttentionBanners } from "@/components/attention-banners";
import { customerDisplayName } from "@/lib/customer-display";

const PAGE_SIZE = 25;

const stateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  PartiallyPaid: "Teilbezahlt",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const stateVariants: Record<InvoiceState, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "secondary",
  Sent: "default",
  PartiallyPaid: "secondary",
  Paid: "outline",
  Overdue: "destructive",
  Canceled: "outline",
};

const filterOptions: { value: string; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "PartiallyPaid", label: "Teilbezahlt" },
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
  canEdit: boolean;
};

async function InvoicesTable({
  activeFilter, term, customerId, currentPage, sortField, sortOrder, baseHref,
  dateFrom, dateTo, sortHrefs, canEdit,
}: TableProps) {
  const dateFromDate = dateFrom ? new Date(dateFrom) : undefined;
  const dateToDate = dateTo ? new Date(dateTo + "T23:59:59") : undefined;

  const where: Prisma.InvoiceWhereInput = {
    ...(customerId ? { customerId } : {}),
    // AND: the overdue filter brings its own OR, which must not clash with the search.
    ...(activeFilter !== "all" ? { AND: [invoiceStateFilter(activeFilter as InvoiceState)] } : {}),
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
                      {canEdit && (
                        <Button size="sm" render={<Link href="/invoices/new" />}>
                          Erste Rechnung erstellen
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">
                      {documentLabel(inv.documentNumber)}
                    </Link>
                    {inv.creditNoteForId !== null && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Gutschrift</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/customers/${inv.customer.customerId}`} className="hover:underline">
                      {customerDisplayName(inv.customer)}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(inv.date)}</TableCell>
                  <TableCell>{inv.creditNoteForId !== null ? "" : formatDate(inv.dueDate)}</TableCell>
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

  const modules = await loadModules();
  const canEdit = isEditorSession(await auth());
  const attention = await loadAttentionCounts(prisma, modules, canEdit);

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
          {canEdit && <ExportButton href={exportHref} />}
          {canEdit && modules.bankImport && (
            <Button variant="outline" size="sm" render={<Link href="/invoices/import" />}>
              Zahlungen importieren
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="outline" size="sm" render={<Link href="/invoices/templates" />}>
                Vorlagen
              </Button>
              <Button render={<Link href="/invoices/new" />}>Neue Rechnung</Button>
            </>
          )}
        </div>
      </div>

      <AttentionBanners banners={attentionBanners(attention, modules, canEdit)} />

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
          canEdit={canEdit}
        />
      </Suspense>
    </div>
  );
}
