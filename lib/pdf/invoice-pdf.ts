import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";
import { calculateInvoiceTotal } from "@/lib/calculations";
import { documentLabel } from "@/lib/document-display";
import type {
  Invoice,
  Quote,
  Item,
  Customer,
  CompanyInformation,
  ApplicationSettings,
} from "@prisma/client";

export type InvoiceWithDetails = Invoice & {
  customer: Customer;
  items: Item[];
  creditNoteFor?: { documentNumber: string | null } | null;
};

export type QuoteWithDetails = Quote & {
  customer: Customer;
  items: Item[];
};

type Settings = ApplicationSettings & {
  companyInfo: CompanyInformation;
};

export async function generateInvoicePdf(
  invoice: InvoiceWithDetails,
  settings: Settings,
  /** qrAmount: CHF amount requested on the QR slip, defaults to the invoice total (reminders pass the open remainder). */
  options: { qrAmount?: number } = {}
): Promise<Buffer> {
  const company = settings.companyInfo;
  const discountPercent = Number(invoice.discountPercent ?? 0);
  const total = calculateInvoiceTotal(
    invoice.items.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent ?? 0),
    })),
    discountPercent
  );

  const draft = !invoice.documentNumber;
  const isCreditNote = invoice.creditNoteForId != null;
  const qr = draft || isCreditNote
    ? null
    : buildQrBillData({
        invoice: { documentNumber: invoice.documentNumber, totalAmount: options.qrAmount ?? total },
        company: { ...company, useHolderNameOnQR: settings.useHolderNameOnQR },
        customer: invoice.customer,
      });

  const doc: RenderDoc = {
    kind: "invoice",
    title: isCreditNote ? "Gutschrift" : "Rechnung",
    documentNumber: documentLabel(invoice.documentNumber),
    numberLabel: isCreditNote ? "Gutschrift-Nr.:" : "Rechnungs-Nr.:",
    date: invoice.date,
    dueDate: isCreditNote ? null : invoice.dueDate,
    referenceLine:
      isCreditNote && invoice.creditNoteFor
        ? `Zu Rechnung ${documentLabel(invoice.creditNoteFor.documentNumber)}`
        : undefined,
    dueLabel: "Fälligkeit:",
    closingNoteLabel: "Zahlbar bis:",
    customUserText: invoice.customUserText,
    discountPercent,
    totalAmount: total,
    customer: invoice.customer,
    items: invoice.items,
    qr,
    draft,
  };

  return generateDocumentPdf(doc, company, settings.numberFormat ?? "de-CH", settings.pdfTheme);
}

export async function generateQuotePdf(
  quote: QuoteWithDetails,
  settings: Settings
): Promise<Buffer> {
  const company = settings.companyInfo;

  const doc: RenderDoc = {
    kind: "quote",
    title: "Offerte",
    documentNumber: documentLabel(quote.documentNumber),
    numberLabel: "Offerten-Nr.:",
    date: quote.date,
    dueDate: quote.validUntil,
    dueLabel: "Gültig bis:",
    closingNoteLabel: "Gültig bis:",
    customUserText: quote.customUserText,
    discountPercent: Number(quote.discountPercent ?? 0),
    totalAmount: Number(quote.totalAmount),
    customer: quote.customer,
    items: quote.items,
    qr: null, // quotes carry no Swiss QR payment slip
    draft: !quote.documentNumber,
  };

  return generateDocumentPdf(doc, company, settings.numberFormat ?? "de-CH", settings.pdfTheme);
}
