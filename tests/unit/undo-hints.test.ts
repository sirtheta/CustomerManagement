import { describe, it, expect } from "vitest";
import { UNDO_HINT_BOOKED, undoHintLaterImport } from "@/lib/import/undo-hints";
import { UNDO_BLOCKED_BOOKED, undoBlockedByLaterImport } from "@/lib/import/bank-import";

describe("undo hints", () => {
  it("are single short lines, shorter than the full reasons", () => {
    const later = undoHintLaterImport("2026-10.xml");
    expect(later).toContain("2026-10.xml");
    for (const hint of [UNDO_HINT_BOOKED, later]) {
      expect(hint).not.toMatch(/\n/);
      expect(hint.length).toBeLessThan(60);
    }
    expect(UNDO_HINT_BOOKED.length).toBeLessThan(UNDO_BLOCKED_BOOKED.length);
    expect(later.length).toBeLessThan(undoBlockedByLaterImport("2026-10.xml").length);
  });
});
