import { describe, it, expect, afterEach } from "vitest";
import { clientIp, ipBucket } from "@/lib/client-ip";

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

  it("returns null when the trusted entry is not an IP address", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    expect(clientIp(headersWithForwardedFor("1.1.1.1, not-an-ip"))).toBeNull();
    expect(clientIp(headersWithForwardedFor("1.1.1.1, " + "a".repeat(500)))).toBeNull();
    expect(clientIp(headersWithForwardedFor("1.1.1.1, 999.1.1.1"))).toBeNull();
    expect(clientIp(headersWithForwardedFor("1.1.1.1, 5.5.5.5; DROP"))).toBeNull();
  });

  it("strips a port added by the proxy", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    expect(clientIp(headersWithForwardedFor("9.9.9.9, 5.5.5.5:49152"))).toBe("5.5.5.5");
    expect(clientIp(headersWithForwardedFor("9.9.9.9, [2001:db8::1]:443"))).toBe("2001:db8::1");
    expect(clientIp(headersWithForwardedFor("[2001:db8::1]"))).toBe("2001:db8::1");
  });
});

describe("ipBucket", () => {
  it("keeps IPv4 as is and collapses IPv4-mapped IPv6", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("collapses IPv6 to its /64, whatever the notation", () => {
    const expected = "2001:db8:1:2::/64";
    expect(ipBucket("2001:db8:1:2::1")).toBe(expected);
    expect(ipBucket("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(expected);
    expect(ipBucket("2001:db8:1:2:ffff::")).toBe(expected);
    expect(ipBucket("2001:DB8:1:2::abcd")).toBe(expected);
  });

  it("handles compressed prefixes", () => {
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("::")).toBe("0:0:0:0::/64");
  });

  it("separates different /64s", () => {
    expect(ipBucket("2001:db8:1:2::1")).not.toBe(ipBucket("2001:db8:1:3::1"));
  });
});
