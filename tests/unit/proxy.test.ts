import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function requestTo(pathname: string) {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

describe("proxy", () => {
  it("passes /api/external/* through without a login redirect", async () => {
    const res = await proxy(requestTo("/api/external/payments"));
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects unauthenticated /api/documents to /login", async () => {
    const res = await proxy(requestTo("/api/documents"));
    expect([307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("still redirects an unauthenticated page request to /login", async () => {
    const res = await proxy(requestTo("/dashboard"));
    expect([307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets unauthenticated users reach the password reset pages", async () => {
    for (const path of ["/forgot-password", "/reset-password"]) {
      const res = await proxy(requestTo(path));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("does not open look-alike paths of the reset pages", async () => {
    const res = await proxy(requestTo("/forgot-passwordx"));
    expect([307, 308]).toContain(res.status);
  });

  it("serves the PWA manifest and icons without a login", async () => {
    for (const path of ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png"]) {
      const res = await proxy(requestTo(path));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("does not open other public-looking paths", async () => {
    for (const path of ["/manifest.webmanifest.bak", "/iconsx/a.png", "/icons"]) {
      const res = await proxy(requestTo(path));
      expect([307, 308], path).toContain(res.status);
    }
  });
});
