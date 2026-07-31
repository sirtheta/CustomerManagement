import { describe, it, expect, afterEach } from "vitest";
import { clientIp } from "@/lib/client-ip";

function headersWithForwardedFor(value: string | null) {
  return { get: (name: string) => (name === "x-forwarded-for" ? value : null) };
}

describe("clientIp", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it("returns null when TRUST_PROXY_HEADERS is unset", () => {
    expect(clientIp(headersWithForwardedFor("1.2.3.4"))).toBeNull();
  });

  it("returns null when the header is missing even with trust configured", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    expect(clientIp(headersWithForwardedFor(null))).toBeNull();
  });

  it("trusts the last entry with one proxy (TRUST_PROXY_HEADERS=true)", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    expect(clientIp(headersWithForwardedFor("9.9.9.9, 5.5.5.5"))).toBe("5.5.5.5");
  });

  it("counts back N entries with a configured proxy count", () => {
    process.env.TRUST_PROXY_HEADERS = "2";
    expect(clientIp(headersWithForwardedFor("1.1.1.1, 2.2.2.2, 3.3.3.3"))).toBe("2.2.2.2");
  });

  it("falls back to the left-most entry when the chain is shorter than the proxy count", () => {
    process.env.TRUST_PROXY_HEADERS = "5";
    expect(clientIp(headersWithForwardedFor("1.1.1.1"))).toBe("1.1.1.1");
  });
});
