import { describe, it, expect } from "vitest";
import { reminderSnoozedUntil } from "@/lib/reminders";

const now = new Date("2026-03-01T10:00:00Z");

describe("reminderSnoozedUntil", () => {
  it("adds the cooldown days to now", () => {
    expect(reminderSnoozedUntil(10, now)).toEqual(new Date("2026-03-11T10:00:00Z"));
  });

  it("falls back to 14 days without a settings row", () => {
    expect(reminderSnoozedUntil(undefined, now)).toEqual(new Date("2026-03-15T10:00:00Z"));
    expect(reminderSnoozedUntil(null, now)).toEqual(new Date("2026-03-15T10:00:00Z"));
  });

  it("keeps a cooldown of 0 days", () => {
    expect(reminderSnoozedUntil(0, now)).toEqual(now);
  });
});
