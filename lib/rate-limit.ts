import { config } from "@/lib/config";

const MAX_ATTEMPTS = config.rateLimit.maxAttempts;
const WINDOW_MS = config.rateLimit.windowMs;

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) return false;

  entry.count++;
  return true;
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}
