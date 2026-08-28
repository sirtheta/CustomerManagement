import { describe, expect, it, vi } from "vitest";
import { saveItemsToCatalog } from "@/lib/service-catalog";
import type { ItemData } from "@/components/items-editor-schema";

function item(overrides: Partial<ItemData> = {}): ItemData {
  return {
    name: "Webentwicklung",
    description: "Individuelle Umsetzung",
    unit: "Hour",
    unitPrice: 120,
    quantity: 1,
    discountPercent: 0,
    totalAmount: 120,
    customText: "",
    categoryId: 7,
    isCustom: true,
    saveToCatalog: true,
    includeDescription: true,
    ...overrides,
  };
}

describe("saveItemsToCatalog", () => {
  it("creates selected custom items with description and category", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const tx = { service: { create } } as never;

    await saveItemsToCatalog(tx, [item()]);

    expect(create).toHaveBeenCalledWith({
      data: {
        name: "Webentwicklung",
        description: "Individuelle Umsetzung",
        unit: "Hour",
        unitPrice: 120,
        isActive: true,
        categoryId: 7,
      },
    });
  });

  it("omits description when not selected", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const tx = { service: { create } } as never;

    await saveItemsToCatalog(tx, [item({ includeDescription: false })]);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: null }),
      })
    );
  });

  it("skips catalog items that are not selected or are existing services", async () => {
    const create = vi.fn();
    const tx = { service: { create } } as never;

    await saveItemsToCatalog(tx, [
      item({ saveToCatalog: false }),
      item({ isCustom: false }),
    ]);

    expect(create).not.toHaveBeenCalled();
  });
});
