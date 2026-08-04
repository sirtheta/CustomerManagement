import { headers } from "next/headers";

/**
 * Canonical origin for absolute links (password-reset emails).
 * Prefers the configured AUTH_URL; the Host header is only a fallback for
 * setups without it (it is client-controlled input).
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.AUTH_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = (await headers()).get("host");
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${proto}://${host}`;
}
