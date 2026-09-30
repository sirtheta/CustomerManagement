import { describe, it, expect } from "vitest";
import { DRAFT_LABEL, documentLabel, fillDocumentNumber } from "@/lib/document-display";

describe("documentLabel", () => {
  it("returns the number when set", () => {
    expect(documentLabel("R-26090001")).toBe("R-26090001");
  });

  it.each([[null], [undefined], [""]])("returns 'Entwurf' for %s", (value) => {
    expect(documentLabel(value)).toBe(DRAFT_LABEL);
    expect(DRAFT_LABEL).toBe("Entwurf");
  });
});

describe("fillDocumentNumber", () => {
  it("replaces every placeholder occurrence", () => {
    expect(
      fillDocumentNumber("Rechnung {documentNumber} / Ref {documentNumber}", "R-26090001")
    ).toBe("Rechnung R-26090001 / Ref R-26090001");
  });

  it("inserts the number literally, without replacement-pattern expansion", () => {
    expect(fillDocumentNumber("Nr. {documentNumber}", "R-$&-$1-$$")).toBe("Nr. R-$&-$1-$$");
  });

  it("leaves text without placeholder unchanged", () => {
    expect(fillDocumentNumber("Guten Tag", "R-1")).toBe("Guten Tag");
  });
});
