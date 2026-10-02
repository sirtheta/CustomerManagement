import { Suspense } from "react";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DeleteCustomerButton from "./DeleteCustomerButton";
import { customerSearchConditions } from "@/lib/customer-search";
import { SearchInput } from "@/components/search-input";
import { SortableColumn } from "@/components/ui/sortable-column";
import { Pagination } from "@/components/ui/pagination";
import { ExportButton } from "@/components/export-button";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { customerDisplayName } from "@/lib/customer-display";

const PAGE_SIZE = 25;

type SortField = "contactPerson" | "city" | "email";
type SortOrder = "asc" | "desc";

type TableProps = {
  term: string;
  archivedOnly: boolean;
  currentPage: number;
  sortField: SortField;
  sortOrder: SortOrder;
  baseHref: string;
  sortHrefs: Record<SortField, string>;
  canEdit: boolean;
  canDelete: boolean;
};

async function CustomersTable({
  term, archivedOnly, currentPage, sortField, sortOrder, baseHref, sortHrefs, canEdit, canDelete,
}: TableProps) {
  const where = {
    archivedAt: archivedOnly ? { not: null } : null,
    ...(term
      ? {
          OR: customerSearchConditions(term),
        }
      : {}),
  };

  const [customers, totalCount] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { invoices: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kunden-Nr.</TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.contactPerson} active={sortField === "contactPerson"} direction={sortOrder}>
                  Firma / Kontakt
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.city} active={sortField === "city"} direction={sortOrder}>
                  Ort
                </SortableColumn>
              </TableHead>
              <TableHead>
                <SortableColumn href={sortHrefs.email} active={sortField === "email"} direction={sortOrder}>
                  E-Mail
                </SortableColumn>
              </TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  {term ? (
                    <p className="text-muted-foreground">Keine Kunden für diesen Suchbegriff.</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-muted-foreground">Noch keine Kunden erfasst.</p>
                      {canEdit && (
                        <Button size="sm" render={<Link href="/customers/new" />}>
                          Ersten Kunden erstellen
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => (
                <TableRow key={c.customerId}>
                  <TableCell>{c.customerNumber ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/customers/${c.customerId}`} className="hover:underline">
                      <div className="font-medium">
                        {customerDisplayName(c)}
                      </div>
                      {!c.contactInsteadOfCompany && c.company && (
                        <div className="text-xs text-gray-500">{c.contactPerson}</div>
                      )}
                      {c.addressNeedsReview && (
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          Adresse prüfen
                        </div>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>{c.zipCode} {c.city}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>
                    {/* With invoices the button archives (Editor), otherwise it deletes (Admin only). */}
                    {(c._count.invoices > 0 ? canEdit : canDelete) && (
                      <DeleteCustomerButton
                        customerId={c.customerId}
                        size="sm"
                        hasInvoices={c._count.invoices > 0}
                        archived={archivedOnly}
                      />
                    )}
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

function CustomersTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kunden-Nr.</TableHead>
            <TableHead>Firma / Kontakt</TableHead>
            <TableHead>Ort</TableHead>
            <TableHead>E-Mail</TableHead>
            <TableHead>Telefon</TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableSkeleton columns={6} />
      </Table>
    </div>
  );
}

type Props = {
  searchParams: Promise<{ search?: string; page?: string; sortBy?: string; order?: string; subscription?: string; archived?: string }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const { search, page, sortBy, order, subscription, archived } = await searchParams;

  // Old link of the subscription filter, which now has its own overview.
  if (subscription === "true") redirect("/subscriptions");

  const session = await auth();
  const canEdit = isEditorSession(session);
  const canDelete = session?.user.role === UserRole.Admin;

  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const sortField: SortField =
    sortBy === "city" || sortBy === "email" ? sortBy : "contactPerson";
  const sortOrder: SortOrder = order === "desc" ? "desc" : "asc";
  const term = search?.trim() ?? "";
  const archivedOnly = archived === "true";

  function sortHref(col: SortField) {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (archivedOnly) p.set("archived", "true");
    p.set("sortBy", col);
    p.set("order", sortField === col && sortOrder === "asc" ? "desc" : "asc");
    return `/customers?${p.toString()}`;
  }

  const baseHref = (() => {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (archivedOnly) p.set("archived", "true");
    if (sortField !== "contactPerson") p.set("sortBy", sortField);
    if (sortOrder !== "asc") p.set("order", sortOrder);
    return `/customers${p.size ? "?" + p.toString() : ""}`;
  })();

  const sortHrefs: Record<SortField, string> = {
    contactPerson: sortHref("contactPerson"),
    city: sortHref("city"),
    email: sortHref("email"),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{archivedOnly ? "Archivierte Kunden" : "Kunden"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href={archivedOnly ? "/customers" : "/customers?archived=true"} />}>
            {archivedOnly ? "Aktive Kunden" : "Archiv"}
          </Button>
          <ExportButton href="/api/export/customers" />
          {canEdit && <Button render={<Link href="/customers/new" />}>Neuer Kunde</Button>}
        </div>
      </div>

      <Suspense fallback={<div className="h-9 rounded-lg border border-input bg-muted animate-pulse" />}>
        <SearchInput defaultValue={search ?? ""} placeholder="Firma, Kontakt, Ort, Kunden-Nr. oder UID suchen…" />
      </Suspense>

      <Suspense fallback={<CustomersTableSkeleton />}>
        <CustomersTable
          term={term}
          archivedOnly={archivedOnly}
          currentPage={currentPage}
          sortField={sortField}
          sortOrder={sortOrder}
          baseHref={baseHref}
          sortHrefs={sortHrefs}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </Suspense>
    </div>
  );
}
