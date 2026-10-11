import type { Unit } from "@prisma/client";
import { isValidDateString } from "@/lib/date";

export const TIME_UNITS: readonly Unit[] = ["Hour", "Day"];
export const MATERIAL_UNITS: readonly Unit[] = ["Piece", "Package"];

export const MAX_QUANTITY = 9999.99;
export const MAX_HOURS_PER_ENTRY = 24;
export const MAX_NAME_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;

export const UNIT_LABELS: Record<Unit, string> = {
  Hour: "Stunde",
  Day: "Tag",
  Piece: "Stück",
  Package: "Pauschal",
};

export const UNIT_SHORT_LABELS: Record<Unit, string> = {
  Hour: "h",
  Day: "Tg.",
  Piece: "Stk.",
  Package: "pausch.",
};

/** Quick-pick buttons on the capture form. */
export const QUICK_AMOUNTS: Record<"Hour" | "Day", number[]> = {
  Hour: [0.5, 1, 2, 4, 8],
  Day: [0.5, 1],
};

export function isTimeUnit(unit: Unit): boolean {
  return TIME_UNITS.includes(unit);
}

/** "1,5" and "1.5" both work; anything that is not a plain positive number gives null. */
export function parseQuantity(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function isMultipleOf(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** A German error message, or null when the quantity is acceptable for the unit. */
export function validateQuantity(quantity: number, unit: Unit): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Die Menge muss grösser als 0 sein.";
  if (quantity > MAX_QUANTITY) return "Die Menge ist zu gross.";
  if (!isMultipleOf(quantity, 0.01)) return "Die Menge darf höchstens 2 Nachkommastellen haben.";
  if (isTimeUnit(unit)) {
    if (unit === "Hour" && quantity > MAX_HOURS_PER_ENTRY) return "Pro Eintrag sind höchstens 24 Stunden möglich.";
    if (!isMultipleOf(quantity, 0.25)) return "Zeit wird in Viertelstunden (0,25) erfasst.";
  }
  return null;
}

/** `YYYY-MM-DD` to UTC midnight of that calendar day (the form `Payment.date` uses), or null. */
export function parseWorkDate(raw: string): Date | null {
  if (!isValidDateString(raw)) return null;
  return new Date(`${raw}T00:00:00.000Z`);
}

const QUANTITY_FORMAT = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2, useGrouping: false });

export function formatQuantity(quantity: number): string {
  return QUANTITY_FORMAT.format(quantity);
}

export type WorkEntryService = { id: number; name: string; unit: Unit; isActive: boolean };

export type WorkEntryInput = {
  quantityRaw: string;
  serviceId: number | null;
  /** Only used without a service (material that is not in the catalog). */
  freeName: string;
  /** Only used without a service; must be Piece or Package. */
  freeUnit: string;
  note: string;
};

export type ValidWorkEntry = {
  name: string;
  unit: Unit;
  quantity: number;
  serviceId: number | null;
  note: string | null;
};

/**
 * Turns the raw form input into a storable entry. Name and unit come from the service when one is
 * given, never from the client; without a service only material may be entered as free text.
 */
export function resolveWorkEntry(
  input: WorkEntryInput,
  service: WorkEntryService | null
): { error: string } | { value: ValidWorkEntry } {
  const note = input.note.trim();
  if (note.length > MAX_NOTE_LENGTH) return { error: `Die Notiz ist zu lang (max. ${MAX_NOTE_LENGTH} Zeichen).` };

  let name: string;
  let unit: Unit;
  let serviceId: number | null;
  if (input.serviceId != null) {
    if (!service) return { error: "Leistung nicht gefunden." };
    if (!service.isActive) return { error: "Die Leistung ist nicht mehr aktiv." };
    name = service.name;
    unit = service.unit;
    serviceId = service.id;
  } else {
    name = input.freeName.trim();
    if (!name) return { error: "Bitte eine Bezeichnung angeben." };
    if (name.length > MAX_NAME_LENGTH) return { error: `Die Bezeichnung ist zu lang (max. ${MAX_NAME_LENGTH} Zeichen).` };
    if (!(MATERIAL_UNITS as readonly string[]).includes(input.freeUnit)) {
      return { error: "Freie Eingabe ist nur für Material möglich." };
    }
    unit = input.freeUnit as Unit;
    serviceId = null;
  }

  const quantity = parseQuantity(input.quantityRaw);
  if (quantity === null) return { error: "Bitte eine gültige Menge angeben." };
  const quantityError = validateQuantity(quantity, unit);
  if (quantityError) return { error: quantityError };

  return { value: { name, unit, quantity, serviceId, note: note || null } };
}
