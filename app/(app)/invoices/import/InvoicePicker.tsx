"use client";

import { Combobox } from "@base-ui/react/combobox";
import {
  Combobox as ComboboxRoot,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxClear,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
} from "@/components/ui/combobox";
import { formatCurrency } from "@/lib/utils";
import type { ImportOverview } from "@/lib/import/queries";

export type PickableInvoice = ImportOverview["openInvoices"][number];

/** Number with and without separators, so "I 2601 0042" and "26010042" both find "I-26010042". */
function searchText(invoice: PickableInvoice): string {
  return `${invoice.documentNumber} ${invoice.documentNumber.replace(/[^0-9a-z]/gi, "")} ${invoice.customerName}`;
}

export function invoiceLabel(invoice: PickableInvoice): string {
  return invoice.customerName ? `${invoice.documentNumber} · ${invoice.customerName}` : invoice.documentNumber;
}

/** Search over all open invoices (number or customer), for entries the matching found nothing for. */
export function InvoicePicker({
  invoices,
  value,
  onChange,
  ariaLabel,
}: {
  invoices: PickableInvoice[];
  value: number | null;
  onChange: (invoiceId: number | null) => void;
  ariaLabel: string;
}) {
  const textFilter = Combobox.useFilter({ sensitivity: "base" });
  const selected = invoices.find((invoice) => invoice.id === value) ?? null;

  return (
    <ComboboxRoot<PickableInvoice>
      items={invoices}
      value={selected}
      itemToStringLabel={invoiceLabel}
      itemToStringValue={(invoice) => String(invoice.id)}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(item, query) => textFilter.contains(item, query, searchText)}
      onValueChange={(next) => onChange((next as PickableInvoice | null)?.id ?? null)}
    >
      <ComboboxInputGroup className="w-72 max-w-full">
        <ComboboxInput
          className="min-w-0 text-ellipsis"
          aria-label={ariaLabel}
          placeholder="Rechnung oder Kunde suchen…"
        />
        <ComboboxClear />
        <ComboboxTrigger />
      </ComboboxInputGroup>
      <ComboboxContent empty="Keine offene Rechnung gefunden." className="min-w-80 max-h-72">
        {(invoice: PickableInvoice) => (
          <ComboboxItem key={invoice.id} value={invoice}>
            <span className="min-w-0 flex-1 truncate">{invoiceLabel(invoice)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              offen {formatCurrency(invoice.openAmount)}
            </span>
          </ComboboxItem>
        )}
      </ComboboxContent>
    </ComboboxRoot>
  );
}
