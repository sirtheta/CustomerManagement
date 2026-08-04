/**
 * Client IP for rate-limit buckets.
 *
 * `x-forwarded-for` is a request header, so anyone can put anything in it.
 * Reading the leftmost entry — the usual shortcut — means an attacker picks
 * their own bucket key on every request and the per-IP limit stops existing.
 *
 * A reverse proxy *appends* the address it actually saw to the right of the
 * chain, so with a known number of proxies in front of the app the trustworthy
 * value is counted from the right, and everything further left is client-
 * supplied noise. Since only the operator knows how many proxies there are,
 * this has to be configured: `TRUST_PROXY_HEADERS` is the number of proxies
 * (`true` means one). Unset, the header is ignored entirely and callers fall
 * back to limiting per account instead of per IP — no IP is better than one
 * the caller chose.
 */

function trustedProxyCount(): number {
  const raw = process.env.TRUST_PROXY_HEADERS?.trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0") return 0;
  if (raw === "true") return 1;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The client address, or null when there is no trustworthy source for one.
 * Accepts anything with a `get()` — Next's `ReadonlyHeaders` and the `Headers`
 * on an incoming request both qualify.
 */
export function clientIp(headers: { get(name: string): string | null } | undefined): string | null {
  const proxies = trustedProxyCount();
  if (proxies === 0) return null;

  const chain = headers
    ?.get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!chain?.length) return null;

  // The last entry was appended by the proxy closest to us; with N trusted
  // proxies the client sits N entries from the right. A chain shorter than that
  // means the request didn't come through the expected path — treat the
  // left-most entry we have as the best available answer rather than trusting
  // a position that isn't there.
  const index = Math.max(0, chain.length - proxies);
  return chain[index] ?? null;
}
