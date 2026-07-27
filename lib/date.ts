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
