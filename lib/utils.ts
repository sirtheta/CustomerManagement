import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, locale = "de-CH") {
  const value = Number(amount);
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CHF",
  }).format(Math.abs(value));
  // de-CH would print «CHF-1'000.00»; the sign goes in front of the currency instead.
  return value < 0 && Math.abs(value) >= 0.005 ? `-${formatted}` : formatted;
}

// The container runs in UTC unless TZ is set; timestamps are shown in Swiss time regardless.
const SWISS_TIME_ZONE = "Europe/Zurich";

export function formatDate(date: Date | string, locale = "de-CH") {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SWISS_TIME_ZONE,
  }).format(new Date(date));
}

export function formatTime(date: Date | string, locale = "de-CH") {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SWISS_TIME_ZONE,
  }).format(new Date(date));
}
