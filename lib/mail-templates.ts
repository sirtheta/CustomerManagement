import { formatCurrency, formatDate } from "@/lib/utils";
import { customerDisplayName, type CustomerNameFields } from "@/lib/customer-display";
import { MAX_REMINDER_LEVEL, reminderTitle } from "@/lib/reminder-charges";

/**
 * Mail placeholders and default texts for every customer mail (invoice, credit
 * note, quote, reminder, subscription draft). The send dialogs prefill with the
 * same texts the mail code falls back to, so both stay in one place.
 */

export type PlaceholderKey =
  | "documentNumber"
  | "contactPerson"
  | "customerName"
  | "companyName"
  | "totalAmount"
  | "date"
  | "dueDate"
  | "validUntil"
  | "customUserText";

/** A missing (undefined) value leaves its placeholder in the text, e.g. the number of a draft. */
export type PlaceholderValues = Partial<Record<PlaceholderKey, string | undefined>>;

/**
 * Replaces `{key}` for every key with a value. Placeholders without a value and
 * unknown `{words}` stay as they are, so they can still be filled in at send time.
 * The values are inserted literally (no `$&` replacement patterns).
 */
export function fillPlaceholders(template: string, values: PlaceholderValues): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (values as Record<string, string | undefined>)[key];
    return value === undefined ? match : value;
  });
}

/** Fills in the number once it is known (at send time); drafts keep the placeholder until then. */
export function fillDocumentNumber(text: string, documentNumber: string): string {
  return fillPlaceholders(text, { documentNumber });
}

/** Fills in the formatted total at send time, after the positions may have been edited. */
export function fillTotalAmount(text: string, formattedTotal: string): string {
  return fillPlaceholders(text, { totalAmount: formattedTotal });
}

type Amount = { toNumber(): number };

type MailCustomer = CustomerNameFields & { contactPerson: string };

export type InvoiceMailSource = {
  documentNumber: string | null;
  totalAmount: Amount;
  date: Date;
  dueDate: Date;
  customUserText: string | null;
  customer: MailCustomer;
};

export type QuoteMailSource = {
  documentNumber: string | null;
  totalAmount: Amount;
  date: Date;
  validUntil: Date;
  customUserText: string | null;
  customer: MailCustomer;
};

/** Values for an invoice or credit note; credit notes are stored negative, the mail shows the amount. */
export function invoicePlaceholders(invoice: InvoiceMailSource, companyName: string): PlaceholderValues {
  return {
    documentNumber: invoice.documentNumber ?? undefined,
    contactPerson: invoice.customer.contactPerson,
    customerName: customerDisplayName(invoice.customer),
    companyName,
    totalAmount: formatCurrency(Math.abs(invoice.totalAmount.toNumber())),
    date: formatDate(invoice.date),
    dueDate: formatDate(invoice.dueDate),
    customUserText: invoice.customUserText ?? "",
  };
}

export function quotePlaceholders(quote: QuoteMailSource, companyName: string): PlaceholderValues {
  return {
    documentNumber: quote.documentNumber ?? undefined,
    contactPerson: quote.customer.contactPerson,
    customerName: customerDisplayName(quote.customer),
    companyName,
    totalAmount: formatCurrency(quote.totalAmount.toNumber()),
    date: formatDate(quote.date),
    validUntil: formatDate(quote.validUntil),
    customUserText: quote.customUserText ?? "",
  };
}

type MailTemplate = { subject: string; body: string };

// The custom text gets its own paragraph only when there is one, so an empty
// text does not leave a gap in the default mail.
function customTextParagraph(hasCustomText: boolean): string {
  return hasCustomText ? "{customUserText}\n\n" : "";
}

export const DEFAULT_INVOICE_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
export const DEFAULT_CREDIT_NOTE_SUBJECT = "Gutschrift Nr. {documentNumber} – {companyName}";
export const DEFAULT_QUOTE_SUBJECT = "Offerte Nr. {documentNumber} – {companyName}";

export function defaultInvoiceBody(hasCustomText: boolean): string {
  return `Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date} über {totalAmount}.\n\n${customTextParagraph(hasCustomText)}Zahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}`;
}

// Credit notes have no due date and no custom text.
export const DEFAULT_CREDIT_NOTE_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Gutschrift Nr. {documentNumber} vom {date} über {totalAmount}.\n\nMit freundlichen Grüssen\n{companyName}";

export function defaultQuoteBody(hasCustomText: boolean): string {
  return `Guten Tag {contactPerson}\n\nanbei erhalten Sie die Offerte Nr. {documentNumber} vom {date} über {totalAmount}.\n\n${customTextParagraph(hasCustomText)}Gültig bis: {validUntil}\n\nMit freundlichen Grüssen\n{companyName}`;
}

type InvoiceTemplateSettings = {
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
} | null | undefined;

/**
 * Unfilled subject/body for an invoice mail: the templates from the settings
 * (an empty one counts as unset), else the defaults. Credit notes always use
 * their own wording, because the invoice templates talk about a due date.
 */
export function invoiceMailTemplate(
  settings: InvoiceTemplateSettings,
  opts: { isCreditNote: boolean; hasCustomText: boolean }
): MailTemplate {
  if (opts.isCreditNote) return { subject: DEFAULT_CREDIT_NOTE_SUBJECT, body: DEFAULT_CREDIT_NOTE_BODY };
  return {
    subject: settings?.emailSubjectTemplate || DEFAULT_INVOICE_SUBJECT,
    body: settings?.emailBodyTemplate || defaultInvoiceBody(opts.hasCustomText),
  };
}

/** Prefilled invoice/credit-note mail; a draft keeps `{documentNumber}` until it is sent. */
export function invoiceMail(
  invoice: InvoiceMailSource & { creditNoteForId: number | null },
  settings: InvoiceTemplateSettings,
  companyName: string
): MailTemplate {
  const template = invoiceMailTemplate(settings, {
    isCreditNote: invoice.creditNoteForId != null,
    hasCustomText: Boolean(invoice.customUserText),
  });
  const values = invoicePlaceholders(invoice, companyName);
  return { subject: fillPlaceholders(template.subject, values), body: fillPlaceholders(template.body, values) };
}

/** Prefilled quote mail (quotes have no configurable template). */
export function quoteMail(quote: QuoteMailSource, companyName: string): MailTemplate {
  const values = quotePlaceholders(quote, companyName);
  return {
    subject: fillPlaceholders(DEFAULT_QUOTE_SUBJECT, values),
    body: fillPlaceholders(defaultQuoteBody(Boolean(quote.customUserText)), values),
  };
}

type ReminderText = { subjectSuffix: string; opening: string; closing: string };

/**
 * Wording per reminder level (1 = Zahlungserinnerung, 2–4 = 1.–3. Mahnung),
 * getting firmer with each level. Level 4 is the last notice the app sends; it
 * only announces "weitere Schritte", because the app has no debt collection.
 */
const REMINDER_TEXTS: Record<number, ReminderText> = {
  1: {
    subjectSuffix: "",
    opening: "vielleicht ist es Ihnen entgangen: Folgende Rechnung ist noch offen.",
    closing:
      "Wir bitten Sie, den Betrag in den nächsten Tagen zu überweisen. Falls Sie die Zahlung bereits veranlasst haben, betrachten Sie diese Nachricht bitte als gegenstandslos.",
  },
  2: {
    subjectSuffix: "",
    opening: "trotz unserer Zahlungserinnerung ist folgende Rechnung noch nicht beglichen.",
    closing:
      "Bitte überweisen Sie den offenen Betrag innerhalb der Frist auf der beiliegenden Mahnung. Sollte sich Ihre Zahlung mit dieser Nachricht gekreuzt haben, betrachten Sie sie bitte als gegenstandslos.",
  },
  3: {
    subjectSuffix: "",
    opening: "leider haben wir trotz Zahlungserinnerung und Mahnung noch keine Zahlung für folgende Rechnung erhalten.",
    closing:
      "Wir bitten Sie dringend, den offenen Betrag innerhalb der Frist auf der beiliegenden Mahnung zu begleichen. Falls Sie Fragen zur Rechnung haben oder nicht fristgerecht zahlen können, melden Sie sich bitte umgehend bei uns.",
  },
  4: {
    subjectSuffix: " (letzte Mahnung)",
    opening: "dies ist unsere letzte Mahnung: Folgende Rechnung ist trotz mehrerer Mahnungen weiterhin offen.",
    closing:
      "Bitte begleichen Sie den offenen Betrag innerhalb der Frist auf der beiliegenden Mahnung. Erhalten wir bis dahin weder Ihre Zahlung noch eine Rückmeldung, behalten wir uns weitere Schritte vor.",
  },
};

/** Prefilled reminder mail; amounts are passed in because they depend on payments and charges. */
export function reminderMail(params: {
  /** Reminder level 1–4 (`PendingReminder.reminderLevel`); picks title and wording. */
  level: number;
  /** Display label of the invoice number (`documentLabel`, "Entwurf" without one). */
  numberLabel: string;
  contactPerson: string;
  companyName: string;
  dueDate: Date;
  openAmount: number;
  charges?: { feeRappen: number; interestRappen: number; totalRappen: number } | null;
}): MailTemplate {
  const { level, numberLabel, contactPerson, companyName, dueDate, openAmount, charges } = params;
  const text = REMINDER_TEXTS[Math.min(Math.max(level, 1), MAX_REMINDER_LEVEL)];
  const extra =
    charges && (charges.feeRappen > 0 || charges.interestRappen > 0)
      ? `\nMahngebühr: ${formatCurrency(charges.feeRappen / 100)}\nVerzugszins: ${formatCurrency(charges.interestRappen / 100)}\nTotal: ${formatCurrency(charges.totalRappen / 100)}`
      : "";
  const values: PlaceholderValues = {
    documentNumber: numberLabel,
    contactPerson,
    companyName,
    totalAmount: formatCurrency(openAmount),
    dueDate: formatDate(dueDate),
  };
  const subject = `${reminderTitle(level)}${text.subjectSuffix}: Rechnung {documentNumber} – {companyName}`;
  const body = `Guten Tag {contactPerson}\n\n${text.opening}\n\nRechnung Nr.: {documentNumber}\nBetrag: {totalAmount}${extra}\nFälligkeitsdatum: {dueDate}\n\n${text.closing}\n\nMit freundlichen Grüssen\n{companyName}`;
  return { subject: fillPlaceholders(subject, values), body: fillPlaceholders(body, values) };
}
