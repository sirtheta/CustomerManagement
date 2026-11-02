// Where an invoice/quote page was opened from (`?from=`), so breadcrumbs, cancel, save and
// delete lead back there instead of the generic list. Only known in-app paths are accepted.
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";

type FixedTarget = {
  crumbs: BreadcrumbItem[];
  // Opened straight into the edit form: save/cancel return to the page itself, not the document.
  editReturnsHere?: boolean;
};

const FIXED_TARGETS: Record<string, FixedTarget> = {
  "invoices/pending": {
    crumbs: [{ label: "Rechnungen", href: "/invoices" }, { label: "Abo-Rechnungen freigeben", href: "/invoices/pending" }],
    editReturnsHere: true,
  },
  "invoices/reminders": {
    crumbs: [{ label: "Rechnungen", href: "/invoices" }, { label: "Mahnungen", href: "/invoices/reminders" }],
  },
  "accounting/receivables": {
    crumbs: [{ label: "Buchhaltung", href: "/accounting" }, { label: "Offene Posten", href: "/accounting/receivables" }],
  },
};

const CUSTOMER_FROM = /^customers\/\d+$/;

/** Validated `from` value, or null for anything unknown. */
export function parseFrom(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return CUSTOMER_FROM.test(raw) || Object.hasOwn(FIXED_TARGETS, raw) ? raw : null;
}

/** Appends `from` to an in-app path (no-op without one). */
export function withFrom(path: string, from: string | null | undefined): string {
  if (!from) return path;
  return `${path}${path.includes("?") ? "&" : "?"}from=${from}`;
}

/** Leading breadcrumbs for a document page; `fallback` is the document list. */
export function fromCrumbs(
  from: string | null,
  customerName: string,
  fallback: BreadcrumbItem
): BreadcrumbItem[] {
  if (from && CUSTOMER_FROM.test(from)) {
    return [{ label: "Kunden", href: "/customers" }, { label: customerName, href: `/${from}` }];
  }
  return from ? FIXED_TARGETS[from].crumbs : [fallback];
}

/** Target after saving or cancelling the edit form of `documentPath` (e.g. `/invoices/5`). */
export function afterEditHref(documentPath: string, from: string | null): string {
  if (from && FIXED_TARGETS[from]?.editReturnsHere) return `/${from}`;
  return withFrom(documentPath, from);
}

/** Target after deleting a document: the page it was opened from, else the list (with flash). */
export function afterDeleteHref(listPath: string, flash: string, from: string | null): string {
  return from ? `/${from}?flash=${flash}` : `${listPath}?flash=${flash}`;
}
