/**
 * The "Thema" of an invoice or quote: one short line such as "Hosting 2027",
 * printed as subject line in the PDF and filled into mails as `{topic}`.
 */
export const MAX_TOPIC_LENGTH = 100;

/** Normalises the form value: one line, trimmed, at most 100 characters; empty = null. */
export function normalizeTopic(raw: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const topic = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH).trim();
  return topic || null;
}
