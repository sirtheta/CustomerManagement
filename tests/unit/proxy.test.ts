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
});
