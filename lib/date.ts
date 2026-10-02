/**
 * Local-time date helpers for `YYYY-MM-DD` form values.
 *
 * These intentionally avoid `new Date("YYYY-MM-DD")` (parsed as UTC midnight)
 * and `Date.toISOString()` (UTC), which shift the calendar day for users in
 * non-UTC timezones. All parsing and formatting happens in local time.
 */

/** Parse a `YYYY-MM-DD` string into a local-time Date (midnight). */
export function parseDate(str: string | undefined): Date | undefined {
  if (!str) return undefined;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Format a Date into a `YYYY-MM-DD` string using its local calendar day. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Add `days` to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
export function addDays(str: string, days: number): string {
  const d = parseDate(str);
  if (!d) return str;
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

const SWISS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's calendar day (`YYYY-MM-DD`) in Swiss time. The container runs in UTC
 * unless TZ is set, so a payment at 00:30 on 1 January would otherwise land in
 * the previous year.
 */
export function swissDateString(now: Date = new Date()): string {
  const parts = Object.fromEntries(SWISS_DAY.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * UTC midnight of today's Swiss calendar day: the form of `Payment.date` that
 * the payment form and the bank import store (`new Date("YYYY-MM-DD")`) and
 * that the UTC year bounds of analytics and the open items list expect.
 */
export function swissToday(now: Date = new Date()): Date {
  return new Date(`${swissDateString(now)}T00:00:00.000Z`);
}

/** True for a syntactically valid `YYYY-MM-DD` that is also a real calendar day. */
export function isValidDateString(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = parseDate(str);
  return !!d && toDateString(d) === str;
}
