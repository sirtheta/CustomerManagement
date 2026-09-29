import { describe, expect, it } from "vitest";
import { checkStatementAccount } from "@/lib/import/statement-checks";

const company = "CH93 0076 2011 6238 5295 7";

describe("checkStatementAccount", () => {
  it("returns no warnings when currency and IBAN match", () => {
    expect(
      checkStatementAccount({ currency: "CHF", iban: "CH9300762011623852957" }, company)
    ).toEqual([]);
  });

  it("ignores spaces and case when comparing IBANs", () => {
    expect(
      checkStatementAccount({ currency: "CHF", iban: "ch93 0076 2011 6238 5295 7" }, "CH9300762011623852957")
    ).toEqual([]);
  });

  it("warns when the statement currency is not CHF", () => {
    const warnings = checkStatementAccount({ currency: "EUR", iban: "CH9300762011623852957" }, company);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("EUR");
  });

  it("warns when the statement IBAN differs from the company IBAN", () => {
    const warnings = checkStatementAccount({ currency: "CHF", iban: "CH5604835012345678009" }, company);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CH5604835012345678009");
  });

  it("reports both problems at once", () => {
    expect(
      checkStatementAccount({ currency: "EUR", iban: "CH5604835012345678009" }, company)
    ).toHaveLength(2);
  });

  it("skips checks it cannot perform", () => {
    expect(checkStatementAccount({ currency: null, iban: null }, company)).toEqual([]);
    expect(checkStatementAccount({ currency: "CHF", iban: "CH5604835012345678009" }, null)).toEqual([]);
  });
});
