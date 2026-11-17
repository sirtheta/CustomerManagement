import type { SubscriptionIntervalName } from "@/lib/subscription-dates";

/**
 * The "Thema" of an invoice or quote: one short line such as "Hosting 2027",
 * printed as subject line in the PDF and filled into mails as `{topic}`.
 * Templates and subscriptions carry a default topic that may contain
 * `{period}`, the billed period of a subscription invoice.
 */
export const MAX_TOPIC_LENGTH = 100;

export const PERIOD_PLACEHOLDER = "{period}";

/** Normalises the form value: one line, trimmed, at most 100 characters; empty = null. */
export function normalizeTopic(raw: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const topic = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH).trim();
  return topic || null;
}

/**
 * Takes an empty `{key}` out of a text together with what only belongs to it:
 * a line like "Betreff: {key}" (also as the last line), quotes or brackets
 * around it together with a "für", "zu" or "betreffend" right before them
 * (the default texts say "für «{topic}»"), and the separator before it (or
 * after it, at the start), so "Rechnung {documentNumber} – {topic} –
 * {companyName}" does not end up with an empty "–  –". A bare placeholder
 * mid-sentence keeps the sentence.
 */
export function removeEmptyPlaceholder(text: string, key: string): string {
  const p = `\\{${key}\\}`;
  const label = `(?:\\p{L}[\\p{L} .]{0,29}:[ \\t]*)?`;
  return text
    .replace(new RegExp(`^[ \\t]*${label}${p}[ \\t]*\\r?\\n`, "gmu"), "")
    .replace(new RegExp(`\\r?\\n[ \\t]*${label}${p}[ \\t]*$`, "u"), "")
    .replace(new RegExp(`[ \\t]*(?:(?<![\\p{L}])(?:für|zu|betreffend)[ \\t]+)?[«"„“‹'(\\[]${p}[»"“”›')\\]]`, "gu"), "")
    .replace(new RegExp(`[ \\t]*[–—\\-:|/,][ \\t]*${p}`, "g"), "")
    .replace(new RegExp(`${p}[ \\t]*[–—\\-:|/,][ \\t]*`, "g"), "")
    .replace(new RegExp(`[ \\t]*${p}`, "g"), "");
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "November 2026", "Oktober–November 2026" or "Dezember 2026 – Januar 2027" (months 0–11). */
function monthRangeLabel(startYear: number, startMonth: number, endYear: number, endMonth: number): string {
  if (startYear === endYear && startMonth === endMonth) return `${MONTH_NAMES[startMonth]} ${startYear}`;
  return startYear === endYear
    ? `${MONTH_NAMES[startMonth]}–${MONTH_NAMES[endMonth]} ${startYear}`
    : `${MONTH_NAMES[startMonth]} ${startYear} – ${MONTH_NAMES[endMonth]} ${endYear}`;
}

const INTERVAL_MONTHS: Record<SubscriptionIntervalName, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };

/**
 * The period a subscription invoice bills, starting at its invoice date (local
 * time, like the subscription dates): "November 2026", "Q1 2027" or "2027"
 * when the period is a calendar quarter or year, otherwise the month range
 * such as "Februar–April 2027" or "November 2026 – Oktober 2027".
 */
export function subscriptionPeriodLabel(start: Date, interval: SubscriptionIntervalName): string {
  const month = start.getMonth();
  const year = start.getFullYear();
  if (interval === "Monthly") return `${MONTH_NAMES[month]} ${year}`;
  if (interval === "Quarterly" && month % 3 === 0) return `Q${month / 3 + 1} ${year}`;
  if (interval === "Yearly" && month === 0) return String(year);
  const endIndex = month + INTERVAL_MONTHS[interval] - 1;
  return monthRangeLabel(year, month, year + Math.floor(endIndex / 12), endIndex % 12);
}

/**
 * Suggested topic of an invoice from work entries, from the months of the
 * first and last entry (calendar days stored as UTC midnight): "Arbeiten
 * November 2026" or "Arbeiten Oktober–November 2026". Editable in the draft.
 */
export function workEntriesTopic(first: Date, last: Date): string {
  return `Arbeiten ${monthRangeLabel(first.getUTCFullYear(), first.getUTCMonth(), last.getUTCFullYear(), last.getUTCMonth())}`;
}

/**
 * Topic of an invoice created from a template or subscription topic: `{period}`
 * becomes the period, or is removed with its separator when there is none
 * (a template loaded by hand).
 */
export function resolveTopic(template: string | null | undefined, period?: string): string | null {
  if (!template) return null;
  const text =
    period === undefined
      ? removeEmptyPlaceholder(template, "period")
      : template.split(PERIOD_PLACEHOLDER).join(period);
  return normalizeTopic(text);
}
