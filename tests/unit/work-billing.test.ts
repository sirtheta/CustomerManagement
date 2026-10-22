import { describe, it, expect } from "vitest";
import { billingTotal, buildBillingLines, toItemData, type BillableEntry, type BillableService } from "@/lib/work-billing";

const services: Record<number, BillableService> = {
  1: { name: "Gartenpflege", description: null, unit: "Hour", unitPrice: 70, categoryId: 3 },
  2: { name: "Baggern", description: "Inkl. Maschine", unit: "Hour", unitPrice: 120, categoryId: null },
  3: { name: "Rindenmulch", description: null, unit: "Piece", unitPrice: 12.5, categoryId: 4 },
};

const entry = (id: number, date: BillableEntry["date"], serviceId: number | null, name: string, unit: BillableEntry["unit"], quantity: number): BillableEntry => ({
  id, date, serviceId, name, unit, quantity,
});

describe("buildBillingLines", () => {
  it("sums entries of the same service into one line with the catalog price", () => {
    const lines = buildBillingLines(
      [entry(1, "2026-10-12", 1, "Gartenpflege", "Hour", 3), entry(2, "2026-10-14", 1, "Gartenpflege", "Hour", 2.5)],
      services
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key: "s:1", name: "Gartenpflege", unit: "Hour", quantity: 5.5, unitPrice: 70, totalAmount: 385,
      categoryId: 3, priceMissing: false, entryIds: [1, 2],
    });
  });

  it("lists the distinct days, oldest first, in the description", () => {
    const [line] = buildBillingLines(
      [entry(1, "2026-10-20", 1, "x", "Hour", 1), entry(2, "2026-10-12", 1, "x", "Hour", 1), entry(3, "2026-10-12", 1, "x", "Hour", 1)],
      services
    );
    expect(line.description).toBe("Einsatztage: 12.10., 20.10.");
  });

  it("words the days of material as delivery days", () => {
    const [line] = buildBillingLines([entry(1, "2026-10-12", 3, "Rindenmulch", "Piece", 2)], services);
    expect(line.description).toBe("Geliefert am: 12.10.");
  });

  it("puts the catalog description before the days", () => {
    const [line] = buildBillingLines([entry(1, "2026-10-12", 2, "Baggern", "Hour", 1)], services);
    expect(line.description).toBe("Inkl. Maschine\nEinsatztage: 12.10.");
  });

  it("accepts Date objects as entry dates (UTC day)", () => {
    const [line] = buildBillingLines([entry(1, new Date("2026-10-12T00:00:00.000Z"), 1, "x", "Hour", 1)], services);
    expect(line.description).toBe("Einsatztage: 12.10.");
  });

  it("groups free text by name and unit, case-insensitively, with price 0 flagged as missing", () => {
    const lines = buildBillingLines(
      [entry(1, "2026-10-12", null, "Kies 8/16", "Package", 1), entry(2, "2026-10-13", null, " kies 8/16 ", "Package", 2), entry(3, "2026-10-13", null, "Kies 8/16", "Piece", 1)],
      services
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ key: "t:Package:kies 8/16", name: "Kies 8/16", quantity: 3, unitPrice: 0, totalAmount: 0, priceMissing: true });
    expect(lines[1]).toMatchObject({ unit: "Piece", quantity: 1 });
  });

  it("treats a missing service (deleted later) like free text", () => {
    const [line] = buildBillingLines([entry(1, "2026-10-12", 99, "Alte Leistung", "Hour", 2)], services);
    expect(line).toMatchObject({ name: "Alte Leistung", unitPrice: 0, priceMissing: true });
  });

  it("treats an entry like free text when the catalog unit changed after recording", () => {
    // Service 1 is billed per hour now; this entry was recorded in days.
    const [line] = buildBillingLines([entry(1, "2026-10-12", 1, "Gartenpflege", "Day", 2)], services);
    expect(line).toMatchObject({ key: "t:Day:gartenpflege", unit: "Day", quantity: 2, unitPrice: 0, priceMissing: true });
  });

  it("does not flag a catalog service with price 0 as missing", () => {
    const free = { 7: { name: "Gratisleistung", description: null, unit: "Hour" as const, unitPrice: 0, categoryId: null } };
    const [line] = buildBillingLines([entry(1, "2026-10-12", 7, "Gratisleistung", "Hour", 1)], free);
    expect(line).toMatchObject({ unitPrice: 0, priceMissing: false });
  });

  it("prints time lines before material lines", () => {
    const lines = buildBillingLines(
      [entry(1, "2026-10-12", 3, "Rindenmulch", "Piece", 4), entry(2, "2026-10-12", 1, "Gartenpflege", "Hour", 1)],
      services
    );
    expect(lines.map((l) => l.name)).toEqual(["Gartenpflege", "Rindenmulch"]);
  });

  it("adds quantities without floating-point drift", () => {
    const lines = buildBillingLines(
      [entry(1, "2026-10-12", 3, "Rindenmulch", "Piece", 0.1), entry(2, "2026-10-12", 3, "Rindenmulch", "Piece", 0.2)],
      services
    );
    expect(lines[0].quantity).toBe(0.3);
    expect(lines[0].totalAmount).toBe(3.75);
  });
});

describe("billingTotal", () => {
  // 1.01 h x 70 = 70.70 and 1 x 12.52 = 12.52: a sum of 83.22 that is not a multiple of 5 Rappen.
  const priced: Record<number, BillableService> = {
    1: { name: "Gartenpflege", description: null, unit: "Hour", unitPrice: 70, categoryId: null },
    3: { name: "Rindenmulch", description: null, unit: "Piece", unitPrice: 12.52, categoryId: null },
  };
  const lines = buildBillingLines(
    [entry(1, "2026-10-12", 1, "Gartenpflege", "Hour", 1.01), entry(2, "2026-10-12", 3, "Rindenmulch", "Piece", 1)],
    priced
  );

  it("sums the line totals", () => {
    expect(billingTotal(lines)).toBeCloseTo(83.22, 2);
  });

  it("rounds only the total to 5 Rappen when asked", () => {
    expect(billingTotal(lines, { roundTo5Rappen: true })).toBe(83.2);
  });
});

describe("toItemData", () => {
  it("maps a line to an invoice item without discount", () => {
    const [line] = buildBillingLines([entry(1, "2026-10-12", 1, "Gartenpflege", "Hour", 2)], services);
    expect(toItemData(line)).toEqual({
      name: "Gartenpflege",
      description: "Einsatztage: 12.10.",
      unit: "Hour",
      unitPrice: 70,
      quantity: 2,
      discountPercent: 0,
      totalAmount: 140,
      customText: "",
      categoryId: 3,
    });
  });
});
