import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetRateLimit, isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";

// Each test uses a unique key so the module-level store doesn't leak between cases.
let key: string;
beforeEach(() => {
  key = `test:${Math.random()}`;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows the first attempt", () => {
    expect(checkRateLimit(key)).toBe(true);
  });

  it("allows up to 5 attempts", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key)).toBe(true);
    }
  });

  it("blocks the 6th attempt within the window", () => {
    for (let i = 0; i < 5; i++) checkRateLimit(key);
    expect(checkRateLimit(key)).toBe(false);
  });

  it("continues blocking past the 6th attempt", () => {
    for (let i = 0; i < 5; i++) checkRateLimit(key);
    expect(checkRateLimit(key)).toBe(false);
    expect(checkRateLimit(key)).toBe(false);
  });

  it("allows again after the 15-minute window expires", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) checkRateLimit(key);
    expect(checkRateLimit(key)).toBe(false);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(checkRateLimit(key)).toBe(true);
  });

  it("treats different keys independently", () => {
    const keyA = `${key}-a`;
    const keyB = `${key}-b`;
    for (let i = 0; i < 5; i++) checkRateLimit(keyA);

    expect(checkRateLimit(keyA)).toBe(false);
    expect(checkRateLimit(keyB)).toBe(true);
  });
});

describe("resetRateLimit", () => {
  it("allows attempts again immediately after reset", () => {
    for (let i = 0; i < 5; i++) checkRateLimit(key);
    expect(checkRateLimit(key)).toBe(false);

    resetRateLimit(key);

    expect(checkRateLimit(key)).toBe(true);
  });

  it("resetting a key that has no entry is a no-op", () => {
    expect(() => resetRateLimit(`nonexistent:${Math.random()}`)).not.toThrow();
  });
});

describe("per-call limit overrides", () => {
  it("honors a custom maxAttempts instead of the global default", () => {
    for (let i = 0; i < 3; i++) checkRateLimit(key, { maxAttempts: 3 });
    expect(checkRateLimit(key, { maxAttempts: 3 })).toBe(false);
  });
});

describe("isRateLimited / recordFailedAttempt", () => {
  it("does not count a check as an attempt", () => {
    expect(isRateLimited(key, { maxAttempts: 2 })).toBe(false);
    expect(isRateLimited(key, { maxAttempts: 2 })).toBe(false);
    expect(isRateLimited(key, { maxAttempts: 2 })).toBe(false);
  });

  it("becomes limited once enough failures are recorded", () => {
    recordFailedAttempt(key, { maxAttempts: 2 });
    recordFailedAttempt(key, { maxAttempts: 2 });
    expect(isRateLimited(key, { maxAttempts: 2 })).toBe(true);
  });
});
