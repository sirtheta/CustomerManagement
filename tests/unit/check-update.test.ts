import { describe, it, expect, vi, afterEach } from "vitest";

// checkForUpdate() wraps its GitHub call in unstable_cache so the result is
// shared across requests instead of hitting GitHub's rate limit on every page
// view (see lib/check-update.ts). unstable_cache requires a real Next.js
// server's incrementalCache, which doesn't exist under Vitest, so it's
// stubbed here as a passthrough — each test's mocked fetch runs directly,
// uncached, same as the other action tests that mock next/cache.
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

const { checkForUpdate } = await import("@/lib/check-update");

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRelease(tagName: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: tagName }),
    })
  );
}

describe("checkForUpdate", () => {
  it("parses release-please's component-prefixed tags", async () => {
    mockRelease("customer-management-v99.0.0");
    const result = await checkForUpdate();
    expect(result?.latestVersion).toBe("99.0.0");
    expect(result?.hasUpdate).toBe(true);
  });

  it("parses plain vX.Y.Z tags", async () => {
    mockRelease("v99.0.0");
    const result = await checkForUpdate();
    expect(result?.latestVersion).toBe("99.0.0");
    expect(result?.hasUpdate).toBe(true);
  });

  it("returns null when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns null when the tag has no version", async () => {
    mockRelease("nightly");
    expect(await checkForUpdate()).toBeNull();
  });
});
