import { Suspense } from "react";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { GlobalSearch } from "@/components/global-search";
import { customerDisplayName, EMPTY_SEARCH_RESULTS, searchGlobal } from "@/lib/search";
import type { InvoiceState, QuoteState } from "@prisma/client";

const invoiceStateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const invoiceStateVariants: Record<InvoiceState, "default" | "secondary" | "destructive" | "outline"> = {
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

const quoteStateVariants: Record<QuoteState, "default" | "secondary" | "destructive" | "outline"> = {
  Draft: "secondary",
  Sent: "default",
  Accepted: "outline",
  Declined: "destructive",
  Expired: "outline",
};

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const term = q?.trim() ?? "";

  const { customers, invoices, quotes } = term
    ? await searchGlobal(prisma, term)
    : EMPTY_SEARCH_RESULTS;

  const totalResults = customers.length + invoices.length + quotes.length;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Suche</h1>

      <Suspense fallback={null}>
        <GlobalSearch autoFocus={!term} disableDropdown />
      </Suspense>

      {term && (
        <p className="text-sm text-muted-foreground">
          {totalResults === 0
            ? `Keine Ergebnisse für „${term}".`
            : `${totalResults} Ergebnis${totalResults !== 1 ? "se" : ""} für „${term}"`}
        </p>
      )}

      {customers.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Kunden</h2>
            <Link href={`/customers?search=${encodeURIComponent(term)}`} className="text-xs text-primary hover:underline">
              Alle anzeigen
            </Link>
          </div>
          <div className="divide-y border rounded-lg overflow-hidden">
            {customers.map((c) => (
              <Link
                key={c.customerId}
                href={`/customers/${c.customerId}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{customerDisplayName(c)}</p>
                  {!c.contactInsteadOfCompany && c.company && (
                    <p className="text-xs text-muted-foreground">{c.contactPerson}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{c.zipCode} {c.city}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {invoices.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Rechnungen</h2>
            <Link href={`/invoices?search=${encodeURIComponent(term)}`} className="text-xs text-primary hover:underline">
              Alle anzeigen
            </Link>
          </div>
          <div className="divide-y border rounded-lg overflow-hidden">
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/invoices/${inv.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{inv.documentNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.customerName}
                    {" · "}
                    {formatDate(inv.date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatCurrency(inv.totalAmount)}</span>
                  <Badge variant={invoiceStateVariants[inv.state]}>{invoiceStateLabels[inv.state]}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {quotes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Offerten</h2>
            <Link href={`/quotes?search=${encodeURIComponent(term)}`} className="text-xs text-primary hover:underline">
              Alle anzeigen
            </Link>
          </div>
          <div className="divide-y border rounded-lg overflow-hidden">
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{q.documentNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.customerName}
                    {" · "}
                    {formatDate(q.date)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatCurrency(q.totalAmount)}</span>
                  <Badge variant={quoteStateVariants[q.state]}>{quoteStateLabels[q.state]}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!term && (
        <p className="text-sm text-muted-foreground">
          Gib einen Suchbegriff ein, um Kunden, Rechnungen und Offerten zu finden.
        </p>
      )}
    </div>
  );
}
