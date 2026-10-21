import type { Unit } from "@prisma/client";

type UnitInfo = {
  /** Full name in the dropdowns and the services list. */
  label: string;
  /** Compact form next to a quantity (time tracking). */
  short: string;
  /** Column in the invoice/quote PDF, which is narrow. */
  pdf: string;
};

const UNIT_INFO: Record<Unit, UnitInfo> = {
  Hour: { label: "Stunde", short: "h", pdf: "Std." },
  Day: { label: "Tag", short: "Tg.", pdf: "Tag" },
  Minute: { label: "Minute", short: "Min.", pdf: "Min." },
  Week: { label: "Woche", short: "Wo.", pdf: "Woche" },
  Month: { label: "Monat", short: "Mt.", pdf: "Monat" },
  Year: { label: "Jahr", short: "J.", pdf: "Jahr" },
  Piece: { label: "Stück", short: "Stk.", pdf: "Stk." },
  Package: { label: "Pauschal", short: "pausch.", pdf: "Pausch." },
  Meter: { label: "Meter", short: "m", pdf: "m" },
  SquareMeter: { label: "Quadratmeter", short: "m²", pdf: "m²" },
  Kilometer: { label: "Kilometer", short: "km", pdf: "km" },
  Kilogram: { label: "Kilogramm", short: "kg", pdf: "kg" },
  Liter: { label: "Liter", short: "Liter", pdf: "Liter" },
};

/**
 * Every unit in the order the dropdowns show them. A plain tuple (no runtime Prisma import, so
 * client components and zod can use it); `tests/unit/units.test.ts` checks it against the enum.
 */
export const UNIT_VALUES = [
  "Hour",
  "Day",
  "Minute",
  "Week",
  "Month",
  "Year",
  "Piece",
  "Package",
  "Meter",
  "SquareMeter",
  "Kilometer",
  "Kilogram",
  "Liter",
] as const satisfies readonly Unit[];

export const UNIT_LABELS: Record<Unit, string> = Object.fromEntries(
  UNIT_VALUES.map((u) => [u, UNIT_INFO[u].label])
) as Record<Unit, string>;

export const UNIT_SHORT_LABELS: Record<Unit, string> = Object.fromEntries(
  UNIT_VALUES.map((u) => [u, UNIT_INFO[u].short])
) as Record<Unit, string>;

export const UNIT_PDF_LABELS: Record<Unit, string> = Object.fromEntries(
  UNIT_VALUES.map((u) => [u, UNIT_INFO[u].pdf])
) as Record<Unit, string>;

export const UNIT_OPTIONS: { value: Unit; label: string }[] = UNIT_VALUES.map((value) => ({
  value,
  label: UNIT_INFO[value].label,
}));
