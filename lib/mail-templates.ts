import { formatCurrency, formatDate } from "@/lib/utils";
import { customerDisplayName, type CustomerNameFields } from "@/lib/customer-display";
import { buildSalutation, type SalutationFields } from "@/lib/salutation";
import { MAX_REMINDER_LEVEL, reminderTitle } from "@/lib/reminder-charges";
import { removeEmptyPlaceholder } from "@/lib/document-topic";

/**
 * Mail placeholders and default texts for every customer mail (invoice, credit
 * note, quote, reminder, subscription draft). The send dialogs prefill with the
 * same texts the mail code falls back to, so both stay in one place.
 */

export type PlaceholderKey =
  | "documentNumber"
  | "topic"
  | "contactPerson"
  | "salutation"
  | "customerName"
  | "companyName"
  | "totalAmount"
  | "date"
  | "dueDate"
  | "validUntil"
  | "customUserText";

/** A missing (undefined) value leaves its placeholder in the text, e.g. the number of a draft. */
export type PlaceholderValues = Partial<Record<PlaceholderKey, string | undefined>>;

/** An empty `{topic}` is removed with its separator, see `removeEmptyPlaceholder`. */
export function removeEmptyTopic(template: string): string {
  return removeEmptyPlaceholder(template, "topic");
}

/**
 * Replaces `{key}` for every key with a value. Placeholders without a value and
 * unknown `{words}` stay as they are, so they can still be filled in at send time.
 * The values are inserted literally (no `$&` replacement patterns). An empty
 * topic is removed with its separator (`removeEmptyTopic`).
 */
export function fillPlaceholders(template: string, values: PlaceholderValues): string {
  const source = values.topic === "" ? removeEmptyTopic(template) : template;
  return source.replace(/\{(\w+)\}/g, (match, key: string) => {
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

type MailCustomer = CustomerNameFields & Omit<SalutationFields, "contactPerson"> & { contactPerson: string };

export type InvoiceMailSource = {
  documentNumber: string | null;
  topic: string | null;
  totalAmount: Amount;
  date: Date;
  dueDate: Date;
  customUserText: string | null;
  customer: MailCustomer;
};

export type QuoteMailSource = {
  documentNumber: string | null;
  topic: string | null;
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
    topic: invoice.topic ?? "",
    contactPerson: invoice.customer.contactPerson,
    salutation: buildSalutation(invoice.customer),
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
    topic: quote.topic ?? "",
    contactPerson: quote.customer.contactPerson,
    salutation: buildSalutation(quote.customer),
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

// The default texts name the topic only when the document has one, like the custom text.
function topicSubject(subject: string, hasTopic: boolean): string {
  return hasTopic ? subject.replace(" – {companyName}", " – {topic} – {companyName}") : subject;
}

function topicPhrase(hasTopic: boolean): string {
  return hasTopic ? " für «{topic}»" : "";
}

export function defaultInvoiceSubject(hasTopic = false): string {
  return topicSubject(DEFAULT_INVOICE_SUBJECT, hasTopic);
}

export function defaultCreditNoteSubject(hasTopic = false): string {
  return topicSubject(DEFAULT_CREDIT_NOTE_SUBJECT, hasTopic);
}

export function defaultQuoteSubject(hasTopic = false): string {
  return topicSubject(DEFAULT_QUOTE_SUBJECT, hasTopic);
}

export function defaultInvoiceBody(hasCustomText: boolean, hasTopic = false): string {
  return `{salutation}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber}${topicPhrase(hasTopic)} vom {date} über {totalAmount}.\n\n${customTextParagraph(hasCustomText)}Zahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}`;
}

// Credit notes have no due date and no custom text.
export function defaultCreditNoteBody(hasTopic = false): string {
  return `{salutation}\n\nanbei erhalten Sie die Gutschrift Nr. {documentNumber}${topicPhrase(hasTopic)} vom {date} über {totalAmount}.\n\nMit freundlichen Grüssen\n{companyName}`;
}

export const DEFAULT_CREDIT_NOTE_BODY = defaultCreditNoteBody(false);

export function defaultQuoteBody(hasCustomText: boolean, hasTopic = false): string {
  return `{salutation}\n\nanbei erhalten Sie die Offerte Nr. {documentNumber}${topicPhrase(hasTopic)} vom {date} über {totalAmount}.\n\n${customTextParagraph(hasCustomText)}Gültig bis: {validUntil}\n\nMit freundlichen Grüssen\n{companyName}`;
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
  opts: { isCreditNote: boolean; hasCustomText: boolean; hasTopic?: boolean }
): MailTemplate {
  const hasTopic = opts.hasTopic ?? false;
  if (opts.isCreditNote) return { subject: defaultCreditNoteSubject(hasTopic), body: defaultCreditNoteBody(hasTopic) };
  return {
    subject: settings?.emailSubjectTemplate || defaultInvoiceSubject(hasTopic),
    body: settings?.emailBodyTemplate || defaultInvoiceBody(opts.hasCustomText, hasTopic),
  };
}

/** Unfilled subject/body for a quote mail (quotes have no configurable template). */
export function quoteMailTemplate(opts: { hasCustomText: boolean; hasTopic: boolean }): MailTemplate {
  return {
    subject: defaultQuoteSubject(opts.hasTopic),
    body: defaultQuoteBody(opts.hasCustomText, opts.hasTopic),
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
    hasTopic: Boolean(invoice.topic),
  });
  const values = invoicePlaceholders(invoice, companyName);
  return { subject: fillPlaceholders(template.subject, values), body: fillPlaceholders(template.body, values) };
}

/** Prefilled quote mail (quotes have no configurable template). */
export function quoteMail(quote: QuoteMailSource, companyName: string): MailTemplate {
  const values = quotePlaceholders(quote, companyName);
  const template = quoteMailTemplate({ hasCustomText: Boolean(quote.customUserText), hasTopic: Boolean(quote.topic) });
  return {
    subject: fillPlaceholders(template.subject, values),
    body: fillPlaceholders(template.body, values),
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
  /** Topic of the invoice; adds a "Betreff:" line under the number when set. */
  topic?: string | null;
  contactPerson: string;
  /** Letter salutation of the customer; without it the default "Guten Tag <contactPerson>" is used. */
  salutation?: string;
  companyName: string;
  dueDate: Date;
  openAmount: number;
  charges?: {
    feeRappen: number;
    interestRappen: number;
    totalRappen: number;
    paidRappen?: number;
    creditedRappen?: number;
  } | null;
}): MailTemplate {
  const { level, numberLabel, topic, contactPerson, salutation, companyName, dueDate, openAmount, charges } = params;
  const text = REMINDER_TEXTS[Math.min(Math.max(level, 1), MAX_REMINDER_LEVEL)];
  // After a partial payment or credit note only the remainder is requested; say so.
  const received = (charges?.paidRappen ?? 0) > 0 || (charges?.creditedRappen ?? 0) > 0;
  const amountLine = received
    ? "Offener Restbetrag: {totalAmount} (bereits erhaltene Zahlungen und Gutschriften abgezogen)"
    : "Betrag: {totalAmount}";
  const extra =
    charges && (charges.feeRappen > 0 || charges.interestRappen > 0)
      ? `\nMahngebühr: ${formatCurrency(charges.feeRappen / 100)}\nVerzugszins: ${formatCurrency(charges.interestRappen / 100)}\nTotal: ${formatCurrency(charges.totalRappen / 100)}`
      : "";
  const values: PlaceholderValues = {
    documentNumber: numberLabel,
    topic: topic ?? "",
    contactPerson,
    salutation: salutation ?? buildSalutation({ contactPerson }),
    companyName,
    totalAmount: formatCurrency(openAmount),
    dueDate: formatDate(dueDate),
  };
  const subject = `${reminderTitle(level)}${text.subjectSuffix}: Rechnung {documentNumber} – {companyName}`;
  const body = `{salutation}\n\n${text.opening}\n\nRechnung Nr.: {documentNumber}\n${topic ? "Betreff: {topic}\n" : ""}${amountLine}${extra}\nFälligkeitsdatum: {dueDate}\n\n${text.closing}\n\nMit freundlichen Grüssen\n{companyName}`;
  return { subject: fillPlaceholders(subject, values), body: fillPlaceholders(body, values) };
}
