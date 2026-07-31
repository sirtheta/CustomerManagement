import { config } from "@/lib/config";

type Bucket = { count: number; resetAt: number };
type Limit = { maxAttempts?: number; windowMs?: number };

const buckets = new Map<string, Bucket>();

// Keys are derived from unauthenticated input (emails, IPs), so the map must
// not grow without bound. Expired buckets are swept whenever the map gets
// large; if a sweep doesn't help (all buckets still live), the oldest entries
// are dropped — failing open for a few keys is better than exhausting memory.
const MAX_BUCKETS = 10_000;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_BUCKETS) {
    const surplus = buckets.size - MAX_BUCKETS + 1;
    let dropped = 0;
    for (const key of buckets.keys()) {
      if (dropped++ >= surplus) break;
      buckets.delete(key);
    }
  }
}

/**
 * In-memory sliding-window rate limiter (single-process app, no Redis needed).
 * Counts this call as an attempt and returns false once the limit is exceeded.
 */
export function checkRateLimit(key: string, limit: Limit = {}): boolean {
  const maxAttempts = limit.maxAttempts ?? config.rateLimit.maxAttempts;
  const windowMs = limit.windowMs ?? config.rateLimit.windowMs;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxAttempts) return false;
  bucket.count++;
  return true;
}

/**
 * Returns whether `key` is currently over its limit WITHOUT counting an
 * attempt. Pair with `recordFailedAttempt` to throttle only failures (e.g.
 * unknown password-reset tokens) while legitimate traffic stays unthrottled —
 * which is what lets a shared bucket exist without one attacker being able to
 * lock everybody else out.
 */
export function isRateLimited(key: string, limit: Limit = {}): boolean {
  const maxAttempts = limit.maxAttempts ?? config.rateLimit.maxAttempts;
  const bucket = buckets.get(key);
  return !!bucket && bucket.resetAt > Date.now() && bucket.count >= maxAttempts;
}

/** Counts one failed attempt against `key` (see `isRateLimited`). */
export function recordFailedAttempt(key: string, limit: Limit = {}): void {
  checkRateLimit(key, limit);
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
