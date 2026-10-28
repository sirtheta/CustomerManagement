import type { InvoiceState, QuoteState } from "@prisma/client";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const invoiceStateLabels: Record<InvoiceState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  PartiallyPaid: "Teilbezahlt",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

export const invoiceStateVariants: Record<InvoiceState, BadgeVariant> = {
  Draft: "secondary",
  Sent: "default",
  PartiallyPaid: "secondary",
  Paid: "outline",
  Overdue: "destructive",
  Canceled: "outline",
};

export const quoteStateLabels: Record<QuoteState, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Accepted: "Angenommen",
  Declined: "Abgelehnt",
  Expired: "Abgelaufen",
};

export const quoteStateVariants: Record<QuoteState, BadgeVariant> = {
  Draft: "secondary",
  Sent: "default",
  Accepted: "outline",
  Declined: "destructive",
  Expired: "outline",
};

/** Badge for records that can be switched off (users, subscriptions, categories, services). */
export function activeBadge(active: boolean, inactiveLabel = "Inaktiv"): { variant: BadgeVariant; label: string } {
  return active ? { variant: "default", label: "Aktiv" } : { variant: "secondary", label: inactiveLabel };
}
