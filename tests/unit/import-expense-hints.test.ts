import { describe, expect, it } from "vitest";
import {
  buildExpenseHints,
  type CounterpartyHistoryRow,
  type OpenTransaction,
} from "@/lib/import/bank-import";

function open(id: number, counterparty: string | null): OpenTransaction {
  return {
    id,
    date: "2026-03-01",
    amountCents: -1000,
    description: "x",
    counterparty,
    bankReference: null,
  };
}

describe("buildExpenseHints", () => {
  it("never pre-selects a counterparty without history", () => {
    expect(buildExpenseHints([open(1, "Neuer Laden")], [])).toEqual({
      1: { preselect: false, categoryId: null, previouslyIgnored: false },
    });
  });

  it("pre-selects a known business counterparty with its latest category", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Swisscom AG", ignored: false, hasExpense: true, expenseCategoryId: 7 },
      { counterparty: "Swisscom AG", ignored: false, hasExpense: true, expenseCategoryId: 3 },
    ];
    expect(buildExpenseHints([open(1, "SWISSCOM  AG")], history)[1]).toEqual({
      preselect: true,
      categoryId: 7,
      previouslyIgnored: false,
    });
  });

  it("marks a counterparty that was only ever ignored", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Migros", ignored: true, hasExpense: false, expenseCategoryId: null },
    ];
    expect(buildExpenseHints([open(1, "Migros")], history)[1]).toEqual({
      preselect: false,
      categoryId: null,
      previouslyIgnored: true,
    });
  });

  it("an earlier expense beats ignored bookings of the same counterparty", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Coop", ignored: true, hasExpense: false, expenseCategoryId: null },
      { counterparty: "Coop", ignored: false, hasExpense: true, expenseCategoryId: null },
    ];
    expect(buildExpenseHints([open(1, "Coop")], history)[1]).toEqual({
      preselect: true,
      categoryId: null,
      previouslyIgnored: false,
    });
  });

  it("handles missing counterparties", () => {
    expect(buildExpenseHints([open(1, null)], [])[1].preselect).toBe(false);
  });
});
