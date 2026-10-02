import type { SendMailOptions } from "nodemailer";
import type { ApplicationSettings, CompanyInformation, Customer, Invoice, Quote } from "@prisma/client";
import { billingEmail } from "@/lib/customer-billing";
import { createSettingsTransport, isEmailDisabled, settingsSender } from "@/lib/smtp";
import {
  DEFAULT_QUOTE_SUBJECT,
  defaultQuoteBody,
  fillPlaceholders,
  invoiceMailTemplate,
  invoicePlaceholders,
  quotePlaceholders,
} from "@/lib/mail-templates";

type FullSettings = ApplicationSettings & { companyInfo: CompanyInformation };
type FullInvoice = Invoice & { customer: Customer };
type FullQuote = Quote & { customer: Customer };

/** Sends through the stored SMTP settings; does nothing while `DISABLE_EMAIL=true`. */
async function sendWithSettings(settings: FullSettings, mail: Omit<SendMailOptions, "from">): Promise<void> {
  if (isEmailDisabled()) {
    console.log("[email] E-Mail-Versand deaktiviert (DISABLE_EMAIL=true)");
    return;
  }
  const transporter = createSettingsTransport(settings);
  await transporter.sendMail({ from: settingsSender(settings), ...mail });
}

export async function sendInvoiceEmail(
  invoice: FullInvoice,
  settings: FullSettings,
  pdf: Buffer,
  overrides?: { to?: string; subject?: string; body?: string; attachmentName?: string }
): Promise<void> {
  const documentNumber = invoice.documentNumber;
  if (!documentNumber) throw new Error("Rechnung hat noch keine Nummer.");

  const isCreditNote = invoice.creditNoteForId != null;
  const template = invoiceMailTemplate(settings, {
    isCreditNote,
    hasCustomText: Boolean(invoice.customUserText),
  });
  const values = { ...invoicePlaceholders(invoice, settings.companyInfo.companyName || ""), documentNumber };

  await sendWithSettings(settings, {
    to: overrides?.to ?? billingEmail(invoice.customer),
    subject: fillPlaceholders(overrides?.subject ?? template.subject, values),
    text: fillPlaceholders(overrides?.body ?? template.body, values),
    attachments: [
      {
        filename: overrides?.attachmentName ?? `${isCreditNote ? "gutschrift" : "rechnung"}-${documentNumber}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });
}

export function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html><head><meta name="format-detection" content="date=no, telephone=no, address=no, email=no"></head><body style="font-family: sans-serif; white-space: pre-wrap;">${escaped}</body></html>`;
}

export async function sendAccountMail(
  settings: FullSettings,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  await sendWithSettings(settings, { to, subject, text, html: toHtml(text) });
}

export async function sendQuoteEmail(
  quote: FullQuote,
  settings: FullSettings,
  pdf: Buffer,
  overrides?: { to?: string; subject?: string; body?: string }
): Promise<void> {
  const documentNumber = quote.documentNumber;
  if (!documentNumber) throw new Error("Offerte hat noch keine Nummer.");

  const values = { ...quotePlaceholders(quote, settings.companyInfo.companyName || ""), documentNumber };

  await sendWithSettings(settings, {
    to: overrides?.to ?? quote.customer.email,
    subject: fillPlaceholders(overrides?.subject ?? DEFAULT_QUOTE_SUBJECT, values),
    text: fillPlaceholders(overrides?.body ?? defaultQuoteBody(Boolean(quote.customUserText)), values),
    attachments: [{ filename: `offerte-${documentNumber}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
}
