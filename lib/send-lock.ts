export const SEND_IN_PROGRESS_ERROR =
  "Diese Rechnung wird gerade versendet. Bitte kurz warten und die Seite neu laden.";

// The scheduler and the Server Actions are bundled separately, so the set lives on
// globalThis (same reason as the scheduler's start flags).
const globalForLocks = globalThis as unknown as { __sendLocks?: Set<string> };
const held = (globalForLocks.__sendLocks ??= new Set<string>());

/** Lock key shared by every path that mails the same invoice. */
export const invoiceSendLockKey = (invoiceId: number) => `invoice:${invoiceId}`;

/**
 * Keeps one invoice from being mailed twice at the same time (double click, two
 * tabs, subscription job against a manual approval). The mail cannot be recalled
 * once it left, so the second caller is refused instead of waiting.
 *
 * Only guards within one Node process, which is how the app runs (a single
 * container on one SQLite file). Returns a release function, or null if the key is taken.
 */
export function acquireSendLock(key: string): (() => void) | null {
  if (held.has(key)) return null;
  held.add(key);
  return () => {
    held.delete(key);
  };
}
