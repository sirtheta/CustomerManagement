import { describe, it, expect } from "vitest";
import { buildSalutation } from "@/lib/salutation";

const base = { contactPerson: "Anna Muster" };

describe("buildSalutation", () => {
  it("defaults to Guten Tag plus the contact person", () => {
    expect(buildSalutation(base)).toBe("Guten Tag Anna Muster");
    expect(buildSalutation({ ...base, salutationKind: "hello" })).toBe("Guten Tag Anna Muster");
    expect(buildSalutation({ ...base, salutationKind: "unknown" })).toBe("Guten Tag Anna Muster");
  });

  it("builds the informal form with the first name and the gender from the title", () => {
    expect(buildSalutation({ ...base, salutationKind: "dear", title: "Frau" })).toBe("Liebe Anna");
    expect(buildSalutation({ contactPerson: "Max Muster", salutationKind: "dear", title: "Herr" })).toBe("Lieber Max");
  });

  it("builds the formal forms with title and surname", () => {
    expect(buildSalutation({ ...base, salutationKind: "formal", title: "Frau" })).toBe("Sehr geehrte Frau Muster");
    expect(buildSalutation({ contactPerson: "Hans Peter Muster", salutationKind: "formal", title: "Herr" })).toBe(
      "Sehr geehrter Herr Muster"
    );
    expect(buildSalutation({ ...base, salutationKind: "dearFormal", title: "Frau" })).toBe("Liebe Frau Muster");
  });

  it("falls back to the default when a form needs a title and none is set", () => {
    expect(buildSalutation({ ...base, salutationKind: "dear" })).toBe("Guten Tag Anna Muster");
    expect(buildSalutation({ ...base, salutationKind: "formal" })).toBe("Guten Tag Anna Muster");
    expect(buildSalutation({ ...base, salutationKind: "dearFormal" })).toBe("Guten Tag Anna Muster");
  });

  it("needs no name for the plural form", () => {
    expect(buildSalutation({ ...base, salutationKind: "formalPlural" })).toBe("Sehr geehrte Damen und Herren");
  });

  it("uses the free text, trimmed, and falls back when it is empty", () => {
    expect(buildSalutation({ ...base, salutationKind: "custom", salutationText: "  Hoi Anna " })).toBe("Hoi Anna");
    expect(buildSalutation({ ...base, salutationKind: "custom", salutationText: " " })).toBe("Guten Tag Anna Muster");
  });
});
