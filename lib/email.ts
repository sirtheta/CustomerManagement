import nodemailer from "nodemailer";
import type { ApplicationSettings, CompanyInformation, Customer, Invoice, Quote } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { decryptSecret } from "@/lib/crypto";

type FullSettings = ApplicationSettings & { companyInfo: CompanyInformation };
type FullInvoice = Invoice & { customer: Customer };
type FullQuote = Quote & { customer: Customer };

function buildTransport(settings: FullSettings) {
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
    throw new Error("SMTP nicht konfiguriert. Bitte SMTP-Einstellungen hinterlegen.");
  }
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort ?? 587,
    secure: (settings.smtpPort ?? 587) === 465,
    auth: {
      user: settings.smtpUser,
      pass: decryptSecret(settings.smtpPassword),
    },
  });
}

function resolvePlaceholders(
  template: string,
  invoice: FullInvoice,
  settings: FullSettings
): string {
  const c = invoice.customer;
  const displayName =
    c.contactInsteadOfCompany ? c.contactPerson : (c.company || c.contactPerson);

  return template
    .replace(/\{documentNumber\}/g, invoice.documentNumber)
    .replace(/\{contactPerson\}/g, c.contactPerson)
    .replace(/\{companyName\}/g, settings.companyInfo.companyName || "")
    .replace(/\{totalAmount\}/g, formatCurrency(invoice.totalAmount.toNumber()))
    .replace(/\{date\}/g, formatDate(invoice.date))
    .replace(/\{dueDate\}/g, formatDate(invoice.dueDate))
    .replace(/\{customUserText\}/g, invoice.customUserText || "")
    .replace(/\{customerName\}/g, displayName);
}

const DEFAULT_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
const DEFAULT_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date} über {totalAmount}.\n\n{customUserText}\n\nZahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}";

export async function sendInvoiceEmail(
  invoice: FullInvoice,
  settings: FullSettings,
  pdf: Buffer,
  overrides?: { to?: string; subject?: string; body?: string }
): Promise<void> {
  if (process.env.DISABLE_EMAIL === 'true') {
    console.log('[email] E-Mail-Versand deaktiviert (DISABLE_EMAIL=true)');
    return;
  }

  const transporter = buildTransport(settings);

  const fromName = settings.smtpFromName || settings.companyInfo.companyName || settings.smtpUser;
  const fromAddress = settings.smtpFromAddress || settings.smtpUser;
  const subjectTemplate = settings.emailSubjectTemplate || DEFAULT_SUBJECT;
  const bodyTemplate = settings.emailBodyTemplate || DEFAULT_BODY;

  const subject = resolvePlaceholders(overrides?.subject ?? subjectTemplate, invoice, settings);
  const text = resolvePlaceholders(overrides?.body ?? bodyTemplate, invoice, settings);
  const to = overrides?.to ?? invoice.customer.email;
  const filename = `rechnung-${invoice.documentNumber}.pdf`;

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });
}

function resolveQuotePlaceholders(
  template: string,
  quote: FullQuote,
  settings: FullSettings
): string {
  const c = quote.customer;
  const displayName =
    c.contactInsteadOfCompany ? c.contactPerson : (c.company || c.contactPerson);

  return template
    .replace(/\{documentNumber\}/g, quote.documentNumber)
    .replace(/\{contactPerson\}/g, c.contactPerson)
    .replace(/\{companyName\}/g, settings.companyInfo.companyName || "")
    .replace(/\{totalAmount\}/g, formatCurrency(quote.totalAmount.toNumber()))
    .replace(/\{date\}/g, formatDate(quote.date))
    .replace(/\{validUntil\}/g, formatDate(quote.validUntil))
    .replace(/\{customUserText\}/g, quote.customUserText || "")
    .replace(/\{customerName\}/g, displayName);
}

export const DEFAULT_QUOTE_SUBJECT = "Offerte Nr. {documentNumber} – {companyName}";
export const DEFAULT_QUOTE_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Offerte Nr. {documentNumber} vom {date} über {totalAmount}.\n\n{customUserText}\n\nGültig bis: {validUntil}\n\nMit freundlichen Grüssen\n{companyName}";

export async function sendQuoteEmail(
  quote: FullQuote,
  settings: FullSettings,
  pdf: Buffer,
  overrides?: { to?: string; subject?: string; body?: string }
): Promise<void> {
  if (process.env.DISABLE_EMAIL === 'true') {
    console.log('[email] E-Mail-Versand deaktiviert (DISABLE_EMAIL=true)');
    return;
  }

  const transporter = buildTransport(settings);

  const fromName = settings.smtpFromName || settings.companyInfo.companyName || settings.smtpUser;
  const fromAddress = settings.smtpFromAddress || settings.smtpUser;

  const subject = resolveQuotePlaceholders(overrides?.subject ?? DEFAULT_QUOTE_SUBJECT, quote, settings);
  const text = resolveQuotePlaceholders(overrides?.body ?? DEFAULT_QUOTE_BODY, quote, settings);
  const to = overrides?.to ?? quote.customer.email;
  const filename = `offerte-${quote.documentNumber}.pdf`;

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
  });
}
