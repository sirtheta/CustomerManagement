import type { ApplicationSettings, CompanyInformation } from "@prisma/client";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";
import type { InvoiceWithDetails } from "@/lib/pdf/invoice-pdf";
import { reminderTitle, type ReminderCharges } from "@/lib/reminder-charges";

type Settings = ApplicationSettings & { companyInfo: CompanyInformation };

const DAY_MS = 86_400_000;

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/**
 * Mahnbeleg for an overdue invoice. The QR slip requests the total (open amount
 * plus fee and interest); the invoice itself is not changed.
 */
export async function generateReminderPdf(
  invoice: InvoiceWithDetails,
  settings: Settings,
  charges: ReminderCharges
): Promise<Buffer> {
  if (!invoice.documentNumber) throw new Error("Rechnung hat noch keine Nummer.");
  const company = settings.companyInfo;
  const locale = settings.numberFormat ?? "de-CH";
  const total = charges.totalRappen / 100;

  const amountLines: { label: string; amount: number }[] = [
    { label: "Offener Betrag", amount: charges.openRappen / 100 },
  ];
  if (charges.feeRappen > 0) amountLines.push({ label: "Mahngebühr", amount: charges.feeRappen / 100 });
  if (charges.interestRappen > 0) {
    amountLines.push({
      label: `Verzugszins (${charges.interestPercent} % p. a., ${charges.overdueDays} Tage)`,
      amount: charges.interestRappen / 100,
    });
  }

  const paymentDeadline = new Date(charges.dunningDate.getTime() + (settings.reminderCooldownDays ?? 14) * DAY_MS);

  const doc: RenderDoc = {
    kind: "reminder",
    title: reminderTitle(charges.level),
    documentNumber: invoice.documentNumber,
    numberLabel: "Rechnungs-Nr.:",
    date: charges.dunningDate,
    dueDate: paymentDeadline,
    dueLabel: "Zahlbar bis:",
    closingNoteLabel: "Zahlbar bis:",
    referenceLine: `Rechnung ${invoice.documentNumber} vom ${formatDate(invoice.date, locale)}, fällig am ${formatDate(invoice.dueDate, locale)}`,
    overdueNote:
      charges.overdueDays > 0
        ? `Die Rechnung ist seit ${charges.overdueDays} Tagen überfällig. Bitte überweisen Sie den offenen Betrag bis zum angegebenen Datum.`
        : undefined,
    customUserText: null,
    totalAmount: total,
    customer: invoice.customer,
    items: [],
    amountLines,
    qr: buildQrBillData({
      invoice: { documentNumber: invoice.documentNumber, totalAmount: total },
      company: { ...company, useHolderNameOnQR: settings.useHolderNameOnQR },
      customer: invoice.customer,
    }),
    draft: false,
  };

  return generateDocumentPdf(doc, company, locale, settings.pdfTheme);
}
