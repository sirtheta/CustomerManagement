import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A session whose sessionEpoch no longer matches (password/role/TOTP change,
// deactivation) leaves a dead cookie behind. proxy.ts only sees that the
// cookie exists, so a plain redirect to /login would bounce straight back
// into the app: an endless loop. The redirect target for "no valid session"
// therefore clears the cookie first.

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { GET } from "@/app/api/auth/session-expired/route";
import { SESSION_EXPIRED_PATH } from "@/lib/session-expired";
import { auth } from "@/lib/auth";
import { proxy } from "@/proxy";

function request(cookies: Record<string, string>) {
  const header = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(SESSION_EXPIRED_PATH, "http://localhost:3000"), {
    headers: header ? { cookie: header } : {},
  });
}

describe("session-expired route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(null as never);
  });

  it("clears the dead session cookies and sends the user to /login", async () => {
    const res = await GET(
      request({
        "authjs.session-token": "stale",
        "__Secure-authjs.session-token": "stale",
        "authjs.session-token.0": "chunk",
        "__Secure-authjs.session-token.1": "chunk",
        other: "keep",
      })
    );
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toBe("/login?notice=session-ended");
    const cleared = res.headers.getSetCookie();
    for (const name of [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "authjs.session-token.0",
      "__Secure-authjs.session-token.1",
    ]) {
      const line = cleared.find((c) => c.startsWith(`${name}=`));
      expect(line, name).toBeDefined();
      expect(line).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    }
    expect(cleared.some((c) => c.startsWith("other="))).toBe(false);
  });

  it("sends __Secure- cookies back with the Secure attribute (else browsers ignore the deletion)", async () => {
    const res = await GET(request({ "__Secure-authjs.session-token": "stale" }));
    const line = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-authjs.session-token="));
    expect(line).toMatch(/Secure/i);
  });

  it("does not log out a user whose session is still valid (no forced logout via a link)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "1", role: "Admin" } } as never);
    const res = await GET(request({ "authjs.session-token": "fine" }));
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("is reachable by the proxy with a dead cookie (no bounce back to the app)", async () => {
    const res = await proxy(request({ "authjs.session-token": "stale" }));
    expect(res.headers.get("location")).toBeNull();
  });
});
