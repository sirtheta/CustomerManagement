import { describe, it, expect } from "vitest";
import { buildJournal, journalCsv, JOURNAL_HEADERS } from "@/lib/journal";

const dec = (n: number) => ({ toNumber: () => n });
const cust = { company: "Muster AG", contactPerson: "Anna", contactInsteadOfCompany: false };

const payment = (id: number, date: string, nr: string | null, amount: number) => ({
  id,
  date: new Date(date),
  amount: dec(amount),
  invoice: { documentNumber: nr, customer: cust },
});
const expense = (id: number, date: string, description: string, amount: number, category: string | null) => ({
  id,
  date: new Date(date),
  description,
  amount: dec(amount),
  category: category ? { name: category } : null,
});

describe("buildJournal", () => {
  it("maps payments to Einnahme rows with invoice number and customer", () => {
    const [row] = buildJournal([payment(1, "2026-03-05T10:00:00Z", "I-26030001", 100.5)], []);
    expect(row).toMatchObject({
      type: "Einnahme",
      documentNumber: "I-26030001",
      customer: "Muster AG",
      category: "",
      text: "Zahlung Rechnung I-26030001",
      amountRappen: 10050,
    });
  });

  it("maps expenses to Ausgabe rows with the description as payment reason", () => {
    const [row] = buildJournal([], [expense(7, "2026-03-06T10:00:00Z", "Miete März", 1200, "Miete")]);
    expect(row).toMatchObject({
      type: "Ausgabe",
      documentNumber: "",
      customer: "",
      category: "Miete",
      text: "Miete März",
      amountRappen: 120000,
    });
  });

  it("sorts by date, then Einnahme before Ausgabe, then id", () => {
    const rows = buildJournal(
      [payment(2, "2026-03-05T10:00:00Z", "I-2", 10), payment(1, "2026-03-05T10:00:00Z", "I-1", 10)],
      [expense(9, "2026-03-05T10:00:00Z", "A", 5, null), expense(3, "2026-03-01T10:00:00Z", "B", 5, null)]
    );
    expect(rows.map((r) => [r.type, r.id])).toEqual([
      ["Ausgabe", 3],
      ["Einnahme", 1],
      ["Einnahme", 2],
      ["Ausgabe", 9],
    ]);
  });

  it("labels a payment on an invoice without number as Entwurf", () => {
    const [row] = buildJournal([payment(1, "2026-03-05T10:00:00Z", null, 10)], []);
    expect(row.documentNumber).toBe("");
    expect(row.text).toBe("Zahlung Rechnung Entwurf");
  });
});

describe("journalCsv", () => {
  it("writes the German header and two-decimal amounts", () => {
    const csv = journalCsv(
      buildJournal([payment(1, "2026-03-05T10:00:00Z", "I-1", 10)], [expense(1, "2026-03-06T10:00:00Z", "Porto, Post", 2.5, "Büro")])
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(JOURNAL_HEADERS.join(","));
    expect(lines[1]).toContain("I-1,Einnahme,Muster AG,,Zahlung Rechnung I-1,10.00");
    expect(lines[2]).toContain('Ausgabe,,Büro,"Porto, Post",2.50');
  });
});
