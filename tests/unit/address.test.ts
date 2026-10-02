import { describe, it, expect } from "vitest";
import { formatCityLine, formatStreetLine } from "@/lib/address";

describe("address formatting", () => {
  it("joins street and house number, skipping blanks", () => {
    expect(formatStreetLine("Weg", "1")).toBe("Weg 1");
    expect(formatStreetLine("Weg", null)).toBe("Weg");
    expect(formatStreetLine("Weg", "  ")).toBe("Weg");
  });

  it("joins zip and city", () => {
    expect(formatCityLine("8000", "Zürich")).toBe("8000 Zürich");
    expect(formatCityLine(null, "Zürich")).toBe("Zürich");
  });
});
