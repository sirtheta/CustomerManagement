import { describe, it, expect, vi } from "vitest";
import {
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_REFRESH_STORAGE_KEY,
  SESSION_REFRESH_URL,
  refreshSessionIfDue,
  shouldRefreshSession,
} from "@/lib/session-refresh";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const okFetch = () => vi.fn().mockResolvedValue({ ok: true });

describe("shouldRefreshSession", () => {
  const now = 1_000_000_000_000;

  it("refreshes when nothing was recorded", () => {
    expect(shouldRefreshSession(null, now)).toBe(true);
  });

  it("does not refresh inside the interval", () => {
    expect(shouldRefreshSession(now - SESSION_REFRESH_INTERVAL_MS + 1, now)).toBe(false);
  });

  it("refreshes once the interval has elapsed", () => {
    expect(shouldRefreshSession(now - SESSION_REFRESH_INTERVAL_MS, now)).toBe(true);
  });

  it("refreshes when the stored time lies in the future (clock set back)", () => {
    expect(shouldRefreshSession(now + 60_000, now)).toBe(true);
  });

  it("refreshes when the stored value is not a number", () => {
    expect(shouldRefreshSession(Number.NaN, now)).toBe(true);
  });
});

describe("refreshSessionIfDue", () => {
  const now = 1_000_000_000_000;

  it("calls the session endpoint and records the time when due", async () => {
    const storage = memoryStorage();
    const fetchFn = okFetch();

    const refreshed = await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(refreshed).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      SESSION_REFRESH_URL,
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(storage.data.get(SESSION_REFRESH_STORAGE_KEY)).toBe(String(now));
  });

  it("does nothing while the last refresh is recent", async () => {
    const storage = memoryStorage({ [SESSION_REFRESH_STORAGE_KEY]: String(now - 60_000) });
    const fetchFn = okFetch();

    const refreshed = await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(refreshed).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("records the time before the request so a parallel tab does not repeat it", async () => {
    const storage = memoryStorage();
    let recordedDuringFetch: string | null = null;
    const fetchFn = vi.fn().mockImplementation(async () => {
      recordedDuringFetch = storage.getItem(SESSION_REFRESH_STORAGE_KEY);
      return { ok: true };
    });

    await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(recordedDuringFetch).toBe(String(now));
  });

  it("clears the record after a network error so the next check retries", async () => {
    const storage = memoryStorage();
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));

    const refreshed = await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(refreshed).toBe(false);
    expect(storage.data.has(SESSION_REFRESH_STORAGE_KEY)).toBe(false);
  });

  it("clears the record after a non-ok response", async () => {
    const storage = memoryStorage();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });

    const refreshed = await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(refreshed).toBe(false);
    expect(storage.data.has(SESSION_REFRESH_STORAGE_KEY)).toBe(false);
  });

  it("still works when storage throws (private mode)", async () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const fetchFn = okFetch();

    const refreshed = await refreshSessionIfDue({ storage, fetchFn, now: () => now });

    expect(refreshed).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("works without any storage", async () => {
    const fetchFn = okFetch();

    const refreshed = await refreshSessionIfDue({ storage: null, fetchFn, now: () => now });

    expect(refreshed).toBe(true);
  });
});
