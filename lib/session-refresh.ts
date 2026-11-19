// Sliding session renewal. Auth.js re-signs the JWT and sets a fresh cookie only when
// /api/auth/session is called; auth() in Server Components discards that Set-Cookie and proxy.ts only
// reads the cookie. Without this call the session ends exactly SESSION_MAX_AGE_SEC after login, however
// often the app is used. Client-safe: no server imports.

export const SESSION_REFRESH_URL = "/api/auth/session";
export const SESSION_REFRESH_STORAGE_KEY = "session-refresh-at";
// Far below the session lifetime (7 d), so a normal visit always renews, while a busy user causes
// at most one extra request per hour.
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

type RefreshStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function shouldRefreshSession(
  lastAt: number | null,
  now: number,
  intervalMs: number = SESSION_REFRESH_INTERVAL_MS,
): boolean {
  if (lastAt === null || !Number.isFinite(lastAt)) return true;
  if (lastAt > now) return true; // clock was set back
  return now - lastAt >= intervalMs;
}

// Storage can be missing or throw (private mode, blocked site data): the refresh must still work then.
function readLastRefresh(storage: RefreshStorage | null): number | null {
  try {
    const raw = storage?.getItem(SESSION_REFRESH_STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastRefresh(storage: RefreshStorage | null, now: number): void {
  try {
    storage?.setItem(SESSION_REFRESH_STORAGE_KEY, String(now));
  } catch {
    // ignore
  }
}

function clearLastRefresh(storage: RefreshStorage | null): void {
  try {
    storage?.removeItem(SESSION_REFRESH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface RefreshDeps {
  storage: RefreshStorage | null;
  fetchFn: typeof fetch;
  now?: () => number;
}

/** Calls the session endpoint if the last refresh is older than the interval. Never throws. */
export async function refreshSessionIfDue({ storage, fetchFn, now = Date.now }: RefreshDeps): Promise<boolean> {
  const current = now();
  if (!shouldRefreshSession(readLastRefresh(storage), current)) return false;

  // Recorded before the request so a second tab opening at the same moment does not repeat it.
  writeLastRefresh(storage, current);
  try {
    const res = await fetchFn(SESSION_REFRESH_URL, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch {
    // Offline or server restarting: allow the next check to retry instead of waiting a full interval.
    clearLastRefresh(storage);
    return false;
  }
}
