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
import { formatCurrency } from "@/lib/utils";
import { SearchInput } from "@/components/search-input";
import { SortableColumn } from "@/components/ui/sortable-column";
import { Pagination } from "@/components/ui/pagination";

const PAGE_SIZE = 25;

const unitLabels = {
  Hour: "Stunde",
  Day: "Tag",
  Piece: "Stück",
  Package: "Pauschal",
};

type SortField = "name" | "unitPrice";
type SortOrder = "asc" | "desc";

type Props = {
  searchParams: Promise<{ search?: string; page?: string; sortBy?: string; order?: string }>;
};

export default async function ServicesPage({ searchParams }: Props) {
  const { search, page, sortBy, order } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const sortField: SortField = sortBy === "unitPrice" ? "unitPrice" : "name";
  const sortOrder: SortOrder = order === "desc" ? "desc" : "asc";
  const term = search?.trim() ?? "";

  const where = term
    ? {
        OR: [
          { name: { contains: term } },
          { description: { contains: term } },
          { category: { name: { contains: term } } },
        ],
      }
    : undefined;

  const [services, totalCount] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      include: { category: true },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.service.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function sortHref(col: SortField) {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    p.set("sortBy", col);
    p.set("order", sortField === col && sortOrder === "asc" ? "desc" : "asc");
    return `/services?${p.toString()}`;
  }

  const baseHref = (() => {
    const p = new URLSearchParams();
    if (term) p.set("search", term);
    if (sortField !== "name") p.set("sortBy", sortField);
    if (sortOrder !== "asc") p.set("order", sortOrder);
    return `/services${p.size ? "?" + p.toString() : ""}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leistungen</h1>
        <Button render={<Link href="/services/new" />}>Neue Leistung</Button>
      </div>

      <Suspense fallback={<div className="h-9 rounded-lg border border-input bg-muted animate-pulse" />}>
        <SearchInput defaultValue={search ?? ""} placeholder="Leistung oder Kategorie suchen…" />
      </Suspense>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableColumn href={sortHref("name")} active={sortField === "name"} direction={sortOrder}>
                  Bezeichnung
                </SortableColumn>
              </TableHead>
              <TableHead>Kategorie</TableHead>
              <TableHead>Einheit</TableHead>
              <TableHead>
                <SortableColumn href={sortHref("unitPrice")} active={sortField === "unitPrice"} direction={sortOrder}>
                  Preis
                </SortableColumn>
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                  {term ? "Keine Leistungen für diesen Suchbegriff." : "Keine Leistungen vorhanden."}
                </TableCell>
              </TableRow>
            ) : (
              services.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    {s.description && (
                      <div className="text-xs text-gray-500">{s.description}</div>
                    )}
                  </TableCell>
                  <TableCell>{s.category?.name ?? "—"}</TableCell>
                  <TableCell>{unitLabels[s.unit]}</TableCell>
                  <TableCell>{formatCurrency(s.unitPrice.toNumber())}</TableCell>
                  <TableCell>
                    <Badge variant={s.isActive ? "default" : "secondary"}>
                      {s.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      render={<Link href={`/services/${s.id}`} />}
                    >
                      Bearbeiten
                    </Button>
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
