import { describe, it, expect } from "vitest";
import type { Unit } from "@prisma/client";
import { createTestDatabase } from "../test-utils";
import { loadUnitOrder } from "@/lib/unit-usage";
import { UNIT_VALUES } from "@/lib/units";

// loadUnitOrder against a real database: the dropdowns list the most used unit first, counted
// over document items, template items and catalog services.
describe("loadUnitOrder (real database)", () => {
  const db = createTestDatabase();

  const item = (unit: Unit) =>
    db.prisma.item.create({ data: { name: "x", unit, unitPrice: 1, quantity: 1, totalAmount: 1 } });
  const service = (unit: Unit) =>
    db.prisma.service.create({ data: { name: "x", unit, unitPrice: 1 } });

  it("keeps the fixed order on an empty database", async () => {
    expect(await loadUnitOrder(db.prisma)).toEqual([...UNIT_VALUES]);
  });

  it("puts the most used unit first and adds up items, template items and services", async () => {
    await item("Kilogram");
    await service("Piece");
    await service("Piece");
    const template = await db.prisma.invoiceTemplate.create({ data: { name: "T" } });
    await db.prisma.templateItem.create({
      data: { templateId: template.id, name: "x", unit: "Piece", unitPrice: 1, quantity: 1 },
    });
    await item("Kilogram");

    const order = await loadUnitOrder(db.prisma);

    expect(order.slice(0, 2)).toEqual(["Piece", "Kilogram"]);
    expect(order).toHaveLength(UNIT_VALUES.length);
    expect(new Set(order)).toEqual(new Set(UNIT_VALUES));
  });

  it("keeps the fixed order for units with the same count", async () => {
    await item("Liter");
    await item("Day");

    // Day comes before Liter in UNIT_VALUES, Hour (unused) stays behind both
    const order = await loadUnitOrder(db.prisma);

    expect(order.slice(0, 3)).toEqual(["Day", "Liter", "Hour"]);
  });
});
