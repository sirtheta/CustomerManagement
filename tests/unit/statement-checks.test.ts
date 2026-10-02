import { describe, expect, it } from "vitest";
import { checkBalanceCompleteness, checkBalanceContinuity, checkStatementAccount } from "@/lib/import/statement-checks";

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

describe("checkBalanceCompleteness", () => {
  const base = { openingBalanceCents: 100000, closingBalanceCents: 99550 };

  it("passes when opening plus movements equals closing", () => {
    expect(
      checkBalanceCompleteness({ ...base, transactions: [{ amountCents: -450 }] })
    ).toEqual([]);
  });

  it("warns with the difference when the statement is incomplete", () => {
    const [warning] = checkBalanceCompleteness({
      ...base,
      transactions: [{ amountCents: -200 }],
    });
    expect(warning).toContain("Saldo");
    expect(warning).toContain("2.50");
  });

  it("skips the check when a balance is missing", () => {
    expect(
      checkBalanceCompleteness({ openingBalanceCents: null, closingBalanceCents: 1, transactions: [] })
    ).toEqual([]);
    expect(
      checkBalanceCompleteness({ openingBalanceCents: 1, closingBalanceCents: null, transactions: [] })
    ).toEqual([]);
  });
});

describe("checkBalanceContinuity", () => {
  it("passes when the opening balance equals the previous closing balance", () => {
    expect(
      checkBalanceContinuity(5000, { closingBalanceRappen: 5000, periodTo: "2026-02-28" })
    ).toEqual([]);
  });

  it("warns that a period may be missing when they differ", () => {
    const [warning] = checkBalanceContinuity(5000, {
      closingBalanceRappen: 4000,
      periodTo: "2026-02-28",
    });
    expect(warning).toContain("fehlt");
    expect(warning).toContain("10.00");
    expect(warning).toContain("Saldoprüfung: ");
    expect(warning).toContain("(bis 28.02.2026)");
  });

  it("omits the period when the previous import has none", () => {
    const [warning] = checkBalanceContinuity(5000, { closingBalanceRappen: 4000, periodTo: null });
    expect(warning).toContain("fehlt");
    expect(warning).not.toContain("(bis");
  });

  it("does nothing without a previous import or opening balance", () => {
    expect(checkBalanceContinuity(5000, null)).toEqual([]);
    expect(
      checkBalanceContinuity(null, { closingBalanceRappen: 1, periodTo: null })
    ).toEqual([]);
    expect(
      checkBalanceContinuity(5000, { closingBalanceRappen: null, periodTo: null })
    ).toEqual([]);
  });
});
