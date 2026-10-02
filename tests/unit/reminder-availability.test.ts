import { describe, it, expect } from "vitest";
import { reminderAvailability } from "@/lib/reminders";

const now = new Date("2026-10-02T10:00:00Z");
const pastDue = new Date("2026-09-01T00:00:00Z");
const notDue = new Date("2026-10-30T00:00:00Z");

const base = {
  state: "Overdue" as const,
  dueDate: pastDue,
  isCreditNote: false,
  pendingReminder: { reminderLevel: 2, snoozedUntil: null },
  lastLevelSent: false,
  now,
};

describe("reminderAvailability", () => {
  it("offers the reminder of an overdue invoice that is not snoozed", () => {
    expect(reminderAvailability(base)).toEqual({ kind: "available", level: 2 });
    const expired = { reminderLevel: 3, snoozedUntil: new Date("2026-10-01T00:00:00Z") };
    expect(reminderAvailability({ ...base, pendingReminder: expired })).toEqual({ kind: "available", level: 3 });
  });

  it("reports a snoozed reminder with the date it shows up again", () => {
    const until = new Date("2026-10-10T00:00:00Z");
    expect(reminderAvailability({ ...base, pendingReminder: { reminderLevel: 2, snoozedUntil: until } })).toEqual({
      kind: "snoozed",
      level: 2,
      until,
    });
  });

  it("reports the last level before a snooze", () => {
    const until = new Date("2026-10-10T00:00:00Z");
    expect(
      reminderAvailability({ ...base, lastLevelSent: true, pendingReminder: { reminderLevel: 4, snoozedUntil: until } })
    ).toEqual({ kind: "lastLevelSent" });
  });

  it("waits for the daily job when an overdue invoice has no reminder yet", () => {
    expect(reminderAvailability({ ...base, pendingReminder: null })).toEqual({ kind: "awaitingJob" });
    expect(reminderAvailability({ ...base, state: "Sent", pendingReminder: null })).toEqual({ kind: "awaitingJob" });
  });

  it("explains that partially paid invoices are not reminded once past due", () => {
    expect(reminderAvailability({ ...base, state: "PartiallyPaid", pendingReminder: null })).toEqual({
      kind: "partiallyPaid",
    });
    expect(reminderAvailability({ ...base, state: "PartiallyPaid", dueDate: notDue, pendingReminder: null })).toEqual({
      kind: "none",
    });
  });

  it("has nothing to say for drafts, paid, canceled, credit notes and invoices not yet due", () => {
    for (const state of ["Draft", "Paid", "Canceled"] as const) {
      expect(reminderAvailability({ ...base, state })).toEqual({ kind: "none" });
    }
    expect(reminderAvailability({ ...base, isCreditNote: true })).toEqual({ kind: "none" });
    expect(reminderAvailability({ ...base, state: "Sent", dueDate: notDue, pendingReminder: null })).toEqual({
      kind: "none",
    });
  });
});
