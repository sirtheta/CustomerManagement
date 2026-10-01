import { describe, it, expect } from "vitest";
import { parseYearParam, stichtage, overviewCsv } from "@/lib/year-package";
import { buildJournal } from "@/lib/journal";
import { buildReceivables } from "@/lib/receivables";

const dec = (n: number) => ({ toNumber: () => n });
const now = new Date("2026-09-30T12:00:00Z");

describe("parseYearParam", () => {
  it.each([
    ["2026", 2026],
    ["2000", 2000],
    ["2027", 2027],
  ])("accepts %s", (raw, expected) => {
    expect(parseYearParam(raw, now)).toBe(expected);
  });

  it.each([null, "", "abc", "1999", "2028", "20260", "26", "2026.5", "-2026"])("rejects %s", (raw) => {
    expect(parseYearParam(raw, now)).toBeNull();
  });
});

describe("stichtage", () => {
  it("uses 31.12. for finished years", () => {
    const { prev, end } = stichtage(2025, now);
    expect(prev.toISOString()).toBe("2024-12-31T23:59:59.999Z");
    expect(end.toISOString()).toBe("2025-12-31T23:59:59.999Z");
  });

  it("uses today for the current year", () => {
    expect(stichtage(2026, now).end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });
});

describe("overviewCsv", () => {
  it("sums income, expenses per category, result and debtor change", () => {
    const journal = buildJournal(
      [{ id: 1, date: new Date("2026-03-05T10:00:00Z"), amount: dec(300), invoice: { documentNumber: "I-1", customer: { company: "A", contactPerson: "x", contactInsteadOfCompany: false } } }],
      [
        { id: 1, date: new Date("2026-03-06T10:00:00Z"), description: "Miete", amount: dec(100), category: { name: "Miete" } },
        { id: 2, date: new Date("2026-03-07T10:00:00Z"), description: "Kaffee", amount: dec(20), category: null },
        { id: 3, date: new Date("2026-03-08T10:00:00Z"), description: "Miete 2", amount: dec(100), category: { name: "Miete" } },
      ]
    );
    const invoice = (id: number, total: number) => ({
      id,
      documentNumber: `I-${id}`,
      state: "Sent" as const,
      date: new Date("2025-06-01"),
      dueDate: new Date("2025-07-01"),
      totalAmount: dec(total),
      customer: { customerId: 1, company: "A", contactPerson: "x", contactInsteadOfCompany: false },
      payments: [],
    });
    const prev = buildReceivables([invoice(1, 100)], new Date("2025-12-31"));
    const end = buildReceivables([invoice(1, 100), invoice(2, 250)], new Date("2026-12-31"));

    const csv = overviewCsv(journal, prev, end, "31.12.2025", "31.12.2026");
    expect(csv.split("\n")).toEqual([
      "Position,Betrag (CHF)",
      "Einnahmen gesamt,300.00",
      "Ausgaben Miete,200.00",
      "Ausgaben ohne Kategorie,20.00",
      "Ausgaben gesamt,220.00",
      "Ergebnis,80.00",
      "Debitoren offen per 31.12.2025,100.00",
      "Debitoren offen per 31.12.2026,350.00",
      "Veränderung Debitoren,250.00",
    ]);
  });
});
