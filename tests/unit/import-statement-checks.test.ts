import { describe, expect, it } from "vitest";
import { checkBalanceCompleteness, checkBalanceContinuity } from "@/lib/import/statement-checks";

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
