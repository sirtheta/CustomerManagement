import { describe, it, expect } from "vitest";
import { entityLabel } from "@/lib/audit-labels";

describe("entityLabel", () => {
  it("translates known entity types", () => {
    expect(entityLabel("Invoice")).toBe("Rechnung");
    expect(entityLabel("SentDocument")).toBe("Versand-PDF");
  });
  it("falls back to the stored value", () => {
    expect(entityLabel("Unbekannt")).toBe("Unbekannt");
  });
});
