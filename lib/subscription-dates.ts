export type SubscriptionIntervalName = "Monthly" | "Quarterly" | "Yearly";

export const INTERVAL_LABELS: Record<SubscriptionIntervalName, string> = {
  Monthly: "Monatlich",
  Quarterly: "Quartalsweise",
  Yearly: "Jährlich",
};

const MONTHS: Record<SubscriptionIntervalName, number> = {
  Monthly: 1,
  Quarterly: 3,
  Yearly: 12,
};

/**
 * Adds the interval in local time. A day that does not exist in the target
 * month is clamped to its last day (31 Jan + 1 month = 28/29 Feb). The clamped
 * day is not remembered, so later dates stay on the clamped day.
 */
export function addInterval(date: Date, interval: SubscriptionIntervalName): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + MONTHS[interval]);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

/** Advances at least once and keeps going until the date lies after `today` (catch-up after downtime). */
export function advancePast(date: Date, interval: SubscriptionIntervalName, today: Date): Date {
  let next = addInterval(date, interval);
  while (next.getTime() <= today.getTime()) next = addInterval(next, interval);
  return next;
}
