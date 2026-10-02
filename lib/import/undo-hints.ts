/**
 * One-line forms of the reasons why "Rückgängig" is disabled in the import
 * history (full texts: `UNDO_BLOCKED_BOOKED` / `undoBlockedByLaterImport` in
 * `bank-import.ts`). Dependency-free, so the client component can use them.
 */
export const UNDO_HINT_BOOKED = "Es sind bereits Einträge verbucht.";

export function undoHintLaterImport(filename: string): string {
  return `Später importiert: ${filename}.`;
}
