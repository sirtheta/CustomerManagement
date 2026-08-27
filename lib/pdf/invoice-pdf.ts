import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";
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
  settings: Settings
): Promise<Buffer> {
  const company = settings.companyInfo;
  const total = Number(invoice.totalAmount);

  const qr = buildQrBillData({
    invoice: { documentNumber: invoice.documentNumber, totalAmount: total },
    company: { ...company, useHolderNameOnQR: settings.useHolderNameOnQR },
    customer: invoice.customer,
  });

  const doc: RenderDoc = {
    kind: "invoice",
    title: "Rechnung",
    documentNumber: invoice.documentNumber,
    numberLabel: "Rechnungs-Nr.:",
    date: invoice.date,
    dueDate: invoice.dueDate,
    dueLabel: "Fälligkeit:",
    closingNoteLabel: "Zahlbar bis:",
    customUserText: invoice.customUserText,
    discountPercent: Number(invoice.discountPercent),
    totalAmount: total,
    customer: invoice.customer,
    items: invoice.items,
    qr,
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
    documentNumber: quote.documentNumber,
    numberLabel: "Offerten-Nr.:",
    date: quote.date,
    dueDate: quote.validUntil,
    dueLabel: "Gültig bis:",
    closingNoteLabel: "Gültig bis:",
    customUserText: quote.customUserText,
    totalAmount: Number(quote.totalAmount),
    customer: quote.customer,
    items: quote.items,
    qr: null, // quotes carry no Swiss QR payment slip
  };

  return generateDocumentPdf(doc, company, settings.numberFormat ?? "de-CH", settings.pdfTheme);
}
