export const MAX_REMINDER_LEVEL = 4;

const TITLES: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
  4: "3. Mahnung",
};

export function reminderTitle(level: number): string {
  return TITLES[Math.min(Math.max(level, 1), MAX_REMINDER_LEVEL)];
}

export type ReminderChargeSettings = {
  reminderFeeLevel2Rappen: number;
  reminderFeeLevel3Rappen: number;
  reminderFeeLevel4Rappen: number;
  reminderInterestPercent: { toNumber(): number } | number;
};

export type ReminderCharges = {
  level: number;
  openRappen: number;
  feeRappen: number;
  interestRappen: number;
  totalRappen: number;
  interestPercent: number;
  overdueDays: number;
  dunningDate: Date;
};

const DAY_MS = 86_400_000;

function feeForLevel(level: number, settings: ReminderChargeSettings): number {
  if (level <= 1) return 0;
  if (level === 2) return settings.reminderFeeLevel2Rappen;
  if (level === 3) return settings.reminderFeeLevel3Rappen;
  return settings.reminderFeeLevel4Rappen;
}

/**
 * Amounts printed on a Mahnbeleg. The invoice itself is not changed: fee and
 * interest only appear on the document, on the QR slip and in SentDocument.
 */
export function computeReminderCharges(input: {
  level: number;
  openRappen: number;
  dueDate: Date;
  dunningDate: Date;
  settings: ReminderChargeSettings;
}): ReminderCharges {
  const { level, openRappen, dueDate, dunningDate, settings } = input;
  const rate = settings.reminderInterestPercent;
  const interestPercent = typeof rate === "number" ? rate : rate.toNumber();
  const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const overdueDays = Math.max(0, Math.round((utcDay(dunningDate) - utcDay(dueDate)) / DAY_MS));
  const interestRappen =
    level > 1 && interestPercent > 0 && overdueDays > 0
      ? Math.round((openRappen * (interestPercent / 100) * overdueDays) / 365)
      : 0;
  const feeRappen = feeForLevel(level, settings);

  return {
    level,
    openRappen,
    feeRappen,
    interestRappen,
    totalRappen: openRappen + feeRappen + interestRappen,
    interestPercent,
    overdueDays,
    dunningDate,
  };
}
