import { buildCsv } from "@/lib/csv-export";
import { COUNTRIES } from "@/lib/address";
import { documentLabel } from "@/lib/document-display";
import { AGE_BUCKETS, type ReceivablesReport } from "@/lib/receivables";

export const RECEIVABLES_HEADERS = [
  "Rechnung", "Kunde", "Strasse", "PLZ", "Ort", "Land", "Rechnungsdatum", "Fällig",
  "Total (CHF)", "Bezahlt (CHF)", "Offen (CHF)", "Guthaben (CHF)", "Alter",
];

const chf = (rappen: number) => (rappen / 100).toFixed(2);

/** Debtor list: every open invoice with customer name and address (global totals are not enough for the tax office). */
export function receivablesCsv(report: ReceivablesReport): string {
  return buildCsv(
    RECEIVABLES_HEADERS,
    report.rows.map((r) => [
      documentLabel(r.documentNumber),
      r.customerName,
      r.customerAddress.street,
      r.customerAddress.zip,
      r.customerAddress.city,
      COUNTRIES[r.customerAddress.country] ?? r.customerAddress.country,
      r.date.toLocaleDateString("de-CH"),
      r.dueDate.toLocaleDateString("de-CH"),
      chf(r.totalRappen),
      chf(r.paidRappen),
      chf(r.openRappen),
      chf(r.creditRappen),
      AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? "",
    ])
  );
}
