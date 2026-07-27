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
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { QuoteState } from "@prisma/client";
import { SearchInput } from "@/components/search-input";
import { SortableColumn } from "@/components/ui/sortable-column";
import { Pagination } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { ExportButton } from "@/components/export-button";

const PAGE_SIZE = 25;

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

const filterOptions: { value: string; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "Accepted", label: "Angenommen" },
  { value: "Declined", label: "Abgelehnt" },
  { value: "Expired", label: "Abgelaufen" },
];

type SortField = "documentNumber" | "date" | "validUntil" | "totalAmount" | "state";
type SortOrder = "asc" | "desc";

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

export default async function QuotesPage({ searchParams }: Props) {
  const { state, search, customerId, page, sortBy, order, dateFrom, dateTo } = await searchParams;
  const customerFilter = customerId ? parseInt(customerId, 10) || undefined : undefined;
  const activeFilter = state ?? "all";
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const validSortFields: SortField[] = ["documentNumber", "date", "validUntil", "totalAmount", "state"];
  const sortField: SortField = validSortFields.includes(sortBy as SortField)
    ? (sortBy as SortField)
    : "date";
  const sortOrder: SortOrder = order === "asc" ? "asc" : "desc";
  const term = search?.trim() ?? "";

  const dateFromDate = dateFrom ? new Date(dateFrom) : undefined;
  const dateToDate = dateTo ? new Date(dateTo + "T23:59:59") : undefined;

  const where = {
    ...(customerFilter ? { customerId: customerFilter } : {}),
    ...(activeFilter !== "all" ? { state: activeFilter as QuoteState } : {}),
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

  const [quotes, totalCount] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      include: { customer: true },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.quote.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function sortHref(col: SortField) {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (customerFilter) p.set("customerId", String(customerFilter));
    if (activeFilter !== "all") p.set("state", activeFilter);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    p.set("sortBy", col);
    p.set("order", sortField === col && sortOrder === "desc" ? "asc" : "desc");
    return `/quotes?${p.toString()}`;
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
    return `/quotes${params.size ? "?" + params.toString() : ""}`;
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
    return `/quotes${p.size ? "?" + p.toString() : ""}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-semibold">Offerten</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton href={`/api/export/quotes${activeFilter !== "all" || dateFrom || dateTo ? "?" + new URLSearchParams({ ...(activeFilter !== "all" ? { state: activeFilter } : {}), ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) }).toString() : ""}`} />
          <Button render={<Link href="/quotes/new" />}>Neue Offerte</Button>
        </div>
      </div>

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
        <SearchInput defaultValue={search ?? ""} placeholder="Offerte oder Kunde suchen…" />
      </Suspense>

      <Suspense fallback={null}>
        <DateRangeFilter />
      </Suspense>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableColumn href={sortHref("documentNumber")} active={sortField === "documentNumber"} direction={sortOrder}>
                  Nummer
                </SortableColumn>
              </TableHead>
              <TableHead>Kunde</TableHead>
              <TableHead>
                <SortableColumn href={sortHref("date")} active={sortField === "date"} direction={sortOrder}>
                  Datum
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHref("validUntil")} active={sortField === "validUntil"} direction={sortOrder}>
                  Gültig bis
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHref("totalAmount")} active={sortField === "totalAmount"} direction={sortOrder}>
                  Betrag
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHref("state")} active={sortField === "state"} direction={sortOrder}>
                  Status
                </SortableColumn>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                  {term ? "Keine Offerten für diesen Suchbegriff." : "Keine Offerten vorhanden."}
                </TableCell>
              </TableRow>
            ) : (
              quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">
                    <Link href={`/quotes/${q.id}`} className="hover:underline">
                      {q.documentNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/customers/${q.customer.customerId}`}
                      className="hover:underline"
                    >
                      {q.customer.contactInsteadOfCompany
                        ? q.customer.contactPerson
                        : (q.customer.company || q.customer.contactPerson)}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(q.date)}</TableCell>
                  <TableCell>{formatDate(q.validUntil)}</TableCell>
                  <TableCell>{formatCurrency(q.totalAmount.toNumber())}</TableCell>
                  <TableCell>
                    <Badge variant={stateVariants[q.state]}>
                      {stateLabels[q.state]}
                    </Badge>
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
    </div>
  );
}
