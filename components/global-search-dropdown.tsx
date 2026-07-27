"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { customerDisplayName, type GlobalSearchResults } from "@/lib/search";

export type SearchDropdownItem = {
  key: string;
  href: string;
};

// Single source of truth for the option order: the parent uses this list for
// keyboard navigation, the dropdown derives its option indices from the same
// layout (customers, invoices, quotes, footer).
export function flattenResults(
  results: GlobalSearchResults | null,
  term: string
): SearchDropdownItem[] {
  if (!results) return [];
  const items: SearchDropdownItem[] = [
    ...results.customers.map((c) => ({ key: `customer-${c.customerId}`, href: `/customers/${c.customerId}` })),
    ...results.invoices.map((inv) => ({ key: `invoice-${inv.id}`, href: `/invoices/${inv.id}` })),
    ...results.quotes.map((q) => ({ key: `quote-${q.id}`, href: `/quotes/${q.id}` })),
  ];
  if (items.length > 0) {
    items.push({ key: "all-results", href: `/search?q=${encodeURIComponent(term)}` });
  }
  return items;
}

type Props = {
  results: GlobalSearchResults | null;
  loading: boolean;
  term: string;
  activeIndex: number;
  listboxId: string;
  onSelect: (href: string) => void;
  onHover: (index: number) => void;
};

const groupHeaderClass =
  "px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide";
const optionClass =
  "flex cursor-pointer items-center justify-between gap-3 px-2.5 py-2 data-[active]:bg-accent data-[active]:text-accent-foreground";

export function GlobalSearchDropdown({
  results,
  loading,
  term,
  activeIndex,
  listboxId,
  onSelect,
  onHover,
}: Props) {
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId]);

  const customers = results?.customers ?? [];
  const invoices = results?.invoices ?? [];
  const quotes = results?.quotes ?? [];
  const total = customers.length + invoices.length + quotes.length;

  const invoicesStart = customers.length;
  const quotesStart = invoicesStart + invoices.length;
  const footerIndex = total;

  function optionProps(index: number, href: string) {
    return {
      id: `${listboxId}-option-${index}`,
      role: "option" as const,
      "aria-selected": index === activeIndex,
      "data-active": index === activeIndex ? "" : undefined,
      // preventDefault keeps the input from blurring before the click lands
      onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
      onClick: () => onSelect(href),
      onPointerMove: () => onHover(index),
    };
  }

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Suchergebnisse"
      className="absolute top-full left-0 z-50 mt-1 max-h-96 w-full min-w-72 overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 pb-1"
    >
      {loading ? (
        <div className="flex items-center gap-2 px-2.5 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Suchen…
        </div>
      ) : total === 0 ? (
        <p className="px-2.5 py-2.5 text-sm text-muted-foreground">
          Keine Treffer für „{term}&quot;
        </p>
      ) : (
        <>
          {customers.length > 0 && (
            <div role="presentation" className={groupHeaderClass}>Kunden</div>
          )}
          {customers.map((c, i) => (
            <div key={c.customerId} {...optionProps(i, `/customers/${c.customerId}`)} className={optionClass}>
              <span className="truncate text-sm font-medium">{customerDisplayName(c)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{c.zipCode} {c.city}</span>
            </div>
          ))}

          {invoices.length > 0 && (
            <div role="presentation" className={groupHeaderClass}>Rechnungen</div>
          )}
          {invoices.map((inv, i) => (
            <div key={inv.id} {...optionProps(invoicesStart + i, `/invoices/${inv.id}`)} className={optionClass}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{inv.documentNumber}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {inv.customerName} · {formatDate(inv.date)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium">{formatCurrency(inv.totalAmount)}</span>
            </div>
          ))}

          {quotes.length > 0 && (
            <div role="presentation" className={groupHeaderClass}>Offerten</div>
          )}
          {quotes.map((q, i) => (
            <div key={q.id} {...optionProps(quotesStart + i, `/quotes/${q.id}`)} className={optionClass}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{q.documentNumber}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {q.customerName} · {formatDate(q.date)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium">{formatCurrency(q.totalAmount)}</span>
            </div>
          ))}

          <div
            {...optionProps(footerIndex, `/search?q=${encodeURIComponent(term)}`)}
            className={cn(optionClass, "mt-1 border-t pt-2")}
          >
            <span className="text-sm text-primary">Alle Resultate anzeigen</span>
            <span className="shrink-0 text-xs text-muted-foreground">↵ Enter</span>
          </div>
        </>
      )}
    </div>
  );
}
