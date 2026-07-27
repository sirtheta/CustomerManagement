import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  baseHref: string;
};

export function Pagination({ currentPage, totalPages, totalCount, pageSize, baseHref }: Props) {
  if (totalPages <= 1 && totalCount <= pageSize) return null;

  const sep = baseHref.includes("?") ? "&" : "?";
  const pageHref = (p: number) => `${baseHref}${sep}page=${p}`;

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalCount);

  const pages = buildPageList(currentPage, totalPages);

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        {from}–{to} von {totalCount} Einträgen
      </span>
      <div className="flex items-center gap-1">
        <PaginationLink
          href={pageHref(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Vorherige Seite"
        >
          <ChevronLeft className="size-4" />
        </PaginationLink>

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground select-none">
              …
            </span>
          ) : (
            <PaginationLink
              key={p}
              href={pageHref(p)}
              active={p === currentPage}
            >
              {p}
            </PaginationLink>
          )
        )}

        <PaginationLink
          href={pageHref(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Nächste Seite"
        >
          <ChevronRight className="size-4" />
        </PaginationLink>
      </div>
    </div>
  );
}

type PaginationLinkProps = {
  href: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
  "aria-label"?: string;
};

function PaginationLink({ href, disabled, active, children, "aria-label": ariaLabel }: PaginationLinkProps) {
  if (disabled) {
    return (
      <span
        aria-label={ariaLabel}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-40 cursor-not-allowed select-none"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground font-medium"
          : "hover:bg-muted text-foreground"
      )}
    >
      {children}
    </Link>
  );
}

function buildPageList(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [];
  const addPage = (p: number) => {
    if (!pages.includes(p)) pages.push(p);
  };

  addPage(1);
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    addPage(p);
  }
  if (current < total - 2) pages.push("...");
  addPage(total);

  return pages;
}
