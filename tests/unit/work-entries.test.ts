import { describe, it, expect } from "vitest";
import {
  formatQuantity,
  isTimeUnit,
  parseQuantity,
  parseWorkDate,
  resolveWorkEntry,
  validateQuantity,
  type WorkEntryInput,
} from "@/lib/work-entries";

const base: WorkEntryInput = { quantityRaw: "2", serviceId: null, freeName: "", freeUnit: "", note: "" };
const hourService = { id: 1, name: "Gartenpflege", unit: "Hour" as const, isActive: true };
const pieceService = { id: 2, name: "Rindenmulch", unit: "Piece" as const, isActive: true };

describe("parseQuantity", () => {
  it("accepts a dot or a comma as decimal separator", () => {
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity(" 1,5 ")).toBe(1.5);
    expect(parseQuantity("8")).toBe(8);
  });

  it("rejects anything that is not a plain positive number", () => {
    for (const raw of ["", "abc", "-1", "1e3", "1.2.3", "1,5h"]) expect(parseQuantity(raw)).toBeNull();
  });
});

describe("validateQuantity", () => {
  it("accepts quarter hours up to 24", () => {
    expect(validateQuantity(0.25, "Hour")).toBeNull();
    expect(validateQuantity(24, "Hour")).toBeNull();
  });

  it("rejects zero, too many hours and non-quarter steps for time", () => {
    expect(validateQuantity(0, "Hour")).toMatch(/grösser als 0/);
    expect(validateQuantity(80, "Hour")).toMatch(/24 Stunden/);
    expect(validateQuantity(1.1, "Hour")).toMatch(/Viertel/);
    expect(validateQuantity(0.3, "Day")).toMatch(/Viertel/);
  });

  it("allows free decimals up to 2 places for material, but not more", () => {
    expect(validateQuantity(2.35, "Piece")).toBeNull();
    expect(validateQuantity(1.005, "Piece")).toMatch(/2 Nachkommastellen/);
    expect(validateQuantity(10000, "Package")).toMatch(/zu gross/);
  });
});

describe("parseWorkDate", () => {
  it("returns UTC midnight of a valid calendar day", () => {
    expect(parseWorkDate("2026-10-12")?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("rejects invalid days", () => {
    expect(parseWorkDate("2026-02-30")).toBeNull();
    expect(parseWorkDate("")).toBeNull();
    expect(parseWorkDate("12.10.2026")).toBeNull();
  });
});

describe("resolveWorkEntry", () => {
  it("takes name and unit from the service, not from the client", () => {
    const result = resolveWorkEntry({ ...base, serviceId: 1, freeName: "Hack", freeUnit: "Piece" }, hourService);
    expect(result).toEqual({
      value: { name: "Gartenpflege", unit: "Hour", quantity: 2, serviceId: 1, note: null },
    });
  });

  it("refuses an inactive or missing service", () => {
    expect(resolveWorkEntry({ ...base, serviceId: 1 }, { ...hourService, isActive: false })).toEqual({
      error: "Die Leistung ist nicht mehr aktiv.",
    });
    expect(resolveWorkEntry({ ...base, serviceId: 1 }, null)).toEqual({ error: "Leistung nicht gefunden." });
  });

  it("allows free text only for material", () => {
    const ok = resolveWorkEntry({ ...base, freeName: " Kies ", freeUnit: "Package", quantityRaw: "1" }, null);
    expect(ok).toEqual({ value: { name: "Kies", unit: "Package", quantity: 1, serviceId: null, note: null } });
    expect(resolveWorkEntry({ ...base, freeName: "Arbeit", freeUnit: "Hour" }, null)).toEqual({
      error: "Freie Eingabe ist nur für Material möglich.",
    });
    expect(resolveWorkEntry({ ...base, freeName: "  ", freeUnit: "Piece" }, null)).toEqual({
      error: "Bitte eine Bezeichnung angeben.",
    });
  });

  it("validates the quantity against the unit", () => {
    expect(resolveWorkEntry({ ...base, serviceId: 1, quantityRaw: "abc" }, hourService)).toEqual({
      error: "Bitte eine gültige Menge angeben.",
    });
    expect(resolveWorkEntry({ ...base, serviceId: 1, quantityRaw: "30" }, hourService)).toEqual({
      error: "Pro Eintrag sind höchstens 24 Stunden möglich.",
    });
    expect("value" in resolveWorkEntry({ ...base, serviceId: 2, quantityRaw: "3.5" }, pieceService)).toBe(true);
  });

  it("trims the note, nulls an empty one and limits its length", () => {
    const withNote = resolveWorkEntry({ ...base, serviceId: 1, note: "  Hecke hinten " }, hourService);
    expect(withNote).toMatchObject({ value: { note: "Hecke hinten" } });
    expect(resolveWorkEntry({ ...base, serviceId: 1, note: "x".repeat(501) }, hourService)).toEqual({
      error: "Die Notiz ist zu lang (max. 500 Zeichen).",
    });
  });
});

describe("isTimeUnit / formatQuantity", () => {
  it("tells time from material", () => {
    expect(isTimeUnit("Hour")).toBe(true);
    expect(isTimeUnit("Day")).toBe(true);
    expect(isTimeUnit("Piece")).toBe(false);
    expect(isTimeUnit("Package")).toBe(false);
  });

  it("prints at most two decimals", () => {
    expect(formatQuantity(1.5)).toBe("1.5");
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(0.25)).toBe("0.25");
  });
});
