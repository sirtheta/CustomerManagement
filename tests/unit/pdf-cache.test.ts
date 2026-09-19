import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, rmSync } from "fs";
import { join } from "path";

vi.mock("@/lib/config", () => ({
  config: {
    pdf: { cacheDir: join("tests", ".tmp-pdf-cache-test"), cacheTtlMs: 50, cacheMaxFiles: 3 },
  },
}));

const RELATIVE_CACHE_DIR = join("tests", ".tmp-pdf-cache-test");
const ABS_CACHE_DIR = join(process.cwd(), RELATIVE_CACHE_DIR);

import { readCache, writeCache } from "@/lib/pdf/pdf-cache";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("pdf-cache", () => {
  beforeAll(() => {
    rmSync(ABS_CACHE_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(ABS_CACHE_DIR, { recursive: true, force: true });
  });

  it("returns null for a key that was never written", async () => {
    expect(await readCache("missing-key")).toBeNull();
  });

  it("returns the bytes written for a key", async () => {
    await writeCache("hit-key", Buffer.from("pdf-bytes"));
    const result = await readCache("hit-key");
    expect(result?.toString()).toBe("pdf-bytes");
  });

  it("sanitizes the key so it cannot escape the cache directory", async () => {
    await writeCache("../../evil", Buffer.from("nope"));
    expect(existsSync(join(ABS_CACHE_DIR, "..", "..", "evil.pdf"))).toBe(false);
  });

  it("expires an entry once its TTL has elapsed", async () => {
    await writeCache("ttl-key", Buffer.from("stale-soon"));
    expect(await readCache("ttl-key")).not.toBeNull();
    await sleep(60);
    expect(await readCache("ttl-key")).toBeNull();
  });

  it("evicts the oldest file once cacheMaxFiles is exceeded", async () => {
    await writeCache("evict-a", Buffer.from("a"));
    await sleep(5);
    await writeCache("evict-b", Buffer.from("b"));
    await sleep(5);
    await writeCache("evict-c", Buffer.from("c"));
    await sleep(5);
    // cacheMaxFiles is 3; writing a 4th evicts the oldest (evict-a) to stay at the limit.
    await writeCache("evict-d", Buffer.from("d"));

    expect(await readCache("evict-a")).toBeNull();
    expect((await readCache("evict-b"))?.toString()).toBe("b");
    expect((await readCache("evict-c"))?.toString()).toBe("c");
    expect((await readCache("evict-d"))?.toString()).toBe("d");
  });
});
