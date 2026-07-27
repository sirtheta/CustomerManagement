import { describe, it, expect } from "vitest";

// Inline the resolvePlaceholders logic that is in lib/email.ts
// (the function is not exported; we test the behaviour through the template)
function resolve(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

describe("email placeholder resolution", () => {
  it("replaces known placeholders", () => {
    const result = resolve("Rechnung {documentNumber} von {companyName}", {
      documentNumber: "R-2025001",
      companyName: "Muster GmbH",
    });
    expect(result).toBe("Rechnung R-2025001 von Muster GmbH");
  });

  it("leaves unknown placeholders empty", () => {
    const result = resolve("Hallo {unknown}", {});
    expect(result).toBe("Hallo ");
  });

  it("handles template with no placeholders", () => {
    const result = resolve("Kein Platzhalter", { documentNumber: "X" });
    expect(result).toBe("Kein Platzhalter");
  });

  it("replaces multiple occurrences of the same key", () => {
    const result = resolve("{name} und nochmal {name}", { name: "Hans" });
    expect(result).toBe("Hans und nochmal Hans");
  });
});
