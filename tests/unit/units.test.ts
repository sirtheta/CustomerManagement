import { describe, it, expect } from "vitest";
import { Unit } from "@prisma/client";
import {
  UNIT_LABELS,
  UNIT_OPTIONS,
  UNIT_PDF_LABELS,
  UNIT_SHORT_LABELS,
  UNIT_VALUES,
  sortUnitsByUsage,
} from "@/lib/units";
import { itemDataSchema } from "@/components/items-editor-schema";

describe("units", () => {
  it("lists every Prisma unit exactly once", () => {
    expect([...UNIT_VALUES].sort()).toEqual(Object.values(Unit).sort());
  });

  it("has a non-empty label for every unit in each variant", () => {
    for (const unit of UNIT_VALUES) {
      expect(UNIT_LABELS[unit]).toBeTruthy();
      expect(UNIT_SHORT_LABELS[unit]).toBeTruthy();
      expect(UNIT_PDF_LABELS[unit]).toBeTruthy();
    }
  });

  it("keeps the dropdown order and labels", () => {
    expect(UNIT_OPTIONS.map((o) => o.value)).toEqual([...UNIT_VALUES]);
    expect(UNIT_OPTIONS.find((o) => o.value === "SquareMeter")?.label).toBe("Quadratmeter");
    expect(UNIT_PDF_LABELS.SquareMeter).toBe("m²");
  });

  it("sorts units by usage and keeps the fixed order for ties", () => {
    const sorted = sortUnitsByUsage(new Map<Unit, number>([["Liter", 5], ["Day", 2], ["Kilogram", 2]]));
    expect(sorted.slice(0, 4)).toEqual(["Liter", "Day", "Kilogram", "Hour"]);
    expect(sorted).toHaveLength(UNIT_VALUES.length);
    expect(sortUnitsByUsage(new Map())).toEqual([...UNIT_VALUES]);
  });

  it("accepts the new units in an item", () => {
    const base = {
      name: "x", description: "", unitPrice: 1, quantity: 1, totalAmount: 1, customText: "", categoryId: null,
    };
    expect(itemDataSchema.safeParse({ ...base, unit: "Kilogram" }).success).toBe(true);
    expect(itemDataSchema.safeParse({ ...base, unit: "Furlong" }).success).toBe(false);
  });
});
