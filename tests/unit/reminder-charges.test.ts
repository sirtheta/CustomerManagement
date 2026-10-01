import { describe, it, expect } from "vitest";
import { computeReminderCharges, reminderTitle, MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";

const settings = {
  reminderFeeLevel2Rappen: 1000,
  reminderFeeLevel3Rappen: 2000,
  reminderFeeLevel4Rappen: 3000,
  reminderInterestPercent: 5,
};
const off = { ...settings, reminderFeeLevel2Rappen: 0, reminderFeeLevel3Rappen: 0, reminderFeeLevel4Rappen: 0, reminderInterestPercent: 0 };
const due = new Date("2026-01-01T00:00:00Z");
const dunning = (days: number) => new Date(due.getTime() + days * 86_400_000);

describe("reminderTitle", () => {
  it("maps the four levels", () => {
    expect(reminderTitle(1)).toBe("Zahlungserinnerung");
    expect(reminderTitle(2)).toBe("1. Mahnung");
    expect(reminderTitle(3)).toBe("2. Mahnung");
    expect(reminderTitle(4)).toBe("3. Mahnung");
    expect(MAX_REMINDER_LEVEL).toBe(4);
  });
});

describe("computeReminderCharges", () => {
  it("adds nothing when fees and interest are off", () => {
    const c = computeReminderCharges({ level: 3, openRappen: 100000, dueDate: due, dunningDate: dunning(40), settings: off });
    expect(c).toMatchObject({ feeRappen: 0, interestRappen: 0, totalRappen: 100000, interestPercent: 0, overdueDays: 40 });
  });

  it("charges neither fee nor interest on the Zahlungserinnerung even if both are set", () => {
    const c = computeReminderCharges({ level: 1, openRappen: 50000, dueDate: due, dunningDate: dunning(10), settings });
    expect(c.feeRappen).toBe(0);
    expect(c.interestRappen).toBe(0);
    expect(c.totalRappen).toBe(50000);
  });

  it("works on a reduced remainder (e.g. after a credit note)", () => {
    // 250.00 CHF x 5 % x 73 / 365 = 2.50 CHF
    const c = computeReminderCharges({ level: 2, openRappen: 25000, dueDate: due, dunningDate: dunning(73), settings });
    expect(c.interestRappen).toBe(250);
    expect(c.totalRappen).toBe(25000 + 1000 + 250);
  });

  it("counts calendar days independent of the time of day and the DST change", () => {
    const c = computeReminderCharges({
      level: 2, openRappen: 100000,
      dueDate: new Date("2026-03-20T00:00:00Z"),
      dunningDate: new Date("2026-04-05T23:30:00Z"),
      settings,
    });
    expect(c.overdueDays).toBe(16);
  });

  it("picks the fee of the level", () => {
    const base = { openRappen: 50000, dueDate: due, dunningDate: dunning(0), settings: { ...settings, reminderInterestPercent: 0 } };
    expect(computeReminderCharges({ ...base, level: 2 }).feeRappen).toBe(1000);
    expect(computeReminderCharges({ ...base, level: 3 }).feeRappen).toBe(2000);
    expect(computeReminderCharges({ ...base, level: 4 }).feeRappen).toBe(3000);
  });

  it("computes interest as open x rate x days / 365, rounded to Rappen", () => {
    // 1000.00 CHF x 5 % x 73 / 365 = 10.00 CHF
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(73), settings });
    expect(c.interestRappen).toBe(1000);
    expect(c.feeRappen).toBe(1000);
    expect(c.totalRappen).toBe(102000);
    // 333.33 CHF x 5 % x 30 / 365 = 1.3699 -> 1.37 CHF
    const r = computeReminderCharges({ level: 2, openRappen: 33333, dueDate: due, dunningDate: dunning(30), settings });
    expect(r.interestRappen).toBe(137);
  });

  it("charges no interest when the dunning date is not after the due date", () => {
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(-5), settings });
    expect(c.overdueDays).toBe(0);
    expect(c.interestRappen).toBe(0);
  });

  it("accepts a Decimal-like interest rate", () => {
    const c = computeReminderCharges({
      level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(73),
      settings: { ...settings, reminderInterestPercent: { toNumber: () => 5 } },
    });
    expect(c.interestRappen).toBe(1000);
    expect(c.interestPercent).toBe(5);
  });
});
