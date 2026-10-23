import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";
import { documentLabel } from "@/lib/document-display";
import type {
  Invoice,
  Quote,
  Item,
  Customer,
  CompanyInformation,
  ApplicationSettings,
  SenderProfile,
} from "@prisma/client";
import { applySenderProfile } from "@/lib/sender-profile";

export type InvoiceWithDetails = Invoice & {
  customer: Customer;
  items: Item[];
  creditNoteFor?: { documentNumber: string | null } | null;
  /** Selected sender profile; `null`/missing = the company data. Callers must include it. */
  senderProfile?: SenderProfile | null;
};

export type QuoteWithDetails = Quote & {
  customer: Customer;
  items: Item[];
  senderProfile?: SenderProfile | null;
};

type Settings = ApplicationSettings & {
  companyInfo: CompanyInformation;
};

export async function generateInvoicePdf(
  invoice: InvoiceWithDetails,
  settings: Settings
): Promise<Buffer> {
  const company = settings.companyInfo;
  const sender = applySenderProfile(company, invoice.senderProfile);
  const discountPercent = Number(invoice.discountPercent ?? 0);
  // The stored total is the single source of truth (payments, QR amount and open
  // items use it); recomputing here would ignore the 5-Rappen rounding setting
  // for drafts saved before it was switched.
  const total = Number(invoice.totalAmount);

  const draft = !invoice.documentNumber;
  const isCreditNote = invoice.creditNoteForId != null;
  const qr = draft || isCreditNote
    ? null
    : buildQrBillData({
        invoice: { documentNumber: invoice.documentNumber, totalAmount: total },
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
    draftNote:
      draft && !isCreditNote
        ? company.companyIBAN
          ? "Hinweis (nur im Entwurf): Der QR-Einzahlungsschein wird beim Senden angefügt."
          : "Hinweis (nur im Entwurf): Es fehlt ein QR-Einzahlungsschein, weil keine IBAN hinterlegt ist (Einstellungen)."
        : undefined,
  };

  return generateDocumentPdf(doc, sender, settings.numberFormat ?? "de-CH", settings.pdfTheme);
}

export async function generateQuotePdf(
  quote: QuoteWithDetails,
  settings: Settings
): Promise<Buffer> {
  const company = applySenderProfile(settings.companyInfo, quote.senderProfile);

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
    closingText: quote.closingText,
    discountPercent: Number(quote.discountPercent ?? 0),
    totalAmount: Number(quote.totalAmount),
    customer: quote.customer,
    items: quote.items,
    qr: null, // quotes carry no Swiss QR payment slip
    draft: !quote.documentNumber,
  };

  return generateDocumentPdf(doc, company, settings.numberFormat ?? "de-CH", settings.pdfTheme);
}
