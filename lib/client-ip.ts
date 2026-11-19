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

import { isIP } from "node:net";

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
  return normalizeIp(chain[index]);
}

// The trusted entry still ends up as a map key and in the logs, so anything
// that is not a plain IP address (a client-chosen string when the proxy count
// is too high or the app port is exposed directly, `ip:port` from proxies that
// add the port) is dropped rather than used.
function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let candidate = raw;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) candidate = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  return isIP(candidate) ? candidate : null;
}

/**
 * Rate-limit bucket for an address: IPv4-mapped IPv6 collapses to the IPv4
 * address, other IPv6 addresses to their /64 (a client normally owns a whole
 * /64, so per-address buckets would let it rotate for free).
 */
export function ipBucket(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail === undefined ? [] : tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = tail === undefined ? headParts : [...headParts, ...Array(missing).fill("0"), ...tailParts];
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}
