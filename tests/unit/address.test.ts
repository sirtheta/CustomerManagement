import { describe, it, expect } from "vitest";
import { formatCityLine, formatStreetLine, splitStreetLine } from "@/lib/address";

describe("splitStreetLine", () => {
  it.each([
    ["Musterstrasse 12", "Musterstrasse", "12"],
    ["Musterstrasse 12a", "Musterstrasse", "12a"],
    ["Rue du Marché 5", "Rue du Marché", "5"],
    ["  Hauptstrasse 3  ", "Hauptstrasse", "3"],
    ["Bahnhofplatz 1-3", "Bahnhofplatz", "1-3"],
  ])("splits %j", (input, street, houseNumber) => {
    expect(splitStreetLine(input)).toEqual({ street, houseNumber });
  });

  it.each(["Postfach", "Weg 1, 2. Stock", "7", "Bahnhofstr. 12 a", ""])(
    "keeps %j entirely in the street",
    (input) => {
      expect(splitStreetLine(input)).toEqual({ street: input.trim(), houseNumber: null });
    }
  );
});

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
