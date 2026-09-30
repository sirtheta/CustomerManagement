import { describe, it, expect } from "vitest";
import { ageBucket, buildReceivables, type ReceivableInput } from "@/lib/receivables";

const dec = (n: number) => ({ toNumber: () => n });
const customer = { customerId: 1, company: "Muster AG", contactPerson: "Anna", contactInsteadOfCompany: false };

function inv(over: Partial<ReceivableInput> & { id: number }): ReceivableInput {
  return {
    documentNumber: `R-${over.id}`,
    state: "Sent",
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-02-01"),
    totalAmount: dec(100),
    customer,
    payments: [],
    ...over,
  };
}

describe("ageBucket", () => {
  const asOf = new Date("2026-12-31");
  it("classifies days since due date", () => {
    expect(ageBucket(new Date("2027-01-05"), asOf)).toBe("notDue");
    expect(ageBucket(new Date("2026-12-31"), asOf)).toBe("d0_30");
    expect(ageBucket(new Date("2026-12-01"), asOf)).toBe("d0_30");
    expect(ageBucket(new Date("2026-11-30"), asOf)).toBe("d31_60");
    expect(ageBucket(new Date("2026-10-31"), asOf)).toBe("d61_90");
    expect(ageBucket(new Date("2026-09-01"), asOf)).toBe("d90plus");
  });
});

describe("buildReceivables", () => {
  const asOf = new Date("2026-12-31");

  it("lists unpaid and partially paid invoices with their remaining amount", () => {
    const report = buildReceivables(
      [
        inv({ id: 1 }),
        inv({ id: 2, payments: [{ date: new Date("2026-03-01"), amount: dec(40) }] }),
      ],
      asOf
    );
    expect(report.rows.map((r) => [r.invoiceId, r.openRappen])).toEqual([
      [1, 10000],
      [2, 6000],
    ]);
    expect(report.totalOpenRappen).toBe(16000);
  });

  it("ignores payments after the cut-off date", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Paid", payments: [{ date: new Date("2027-01-15"), amount: dec(100) }] })],
      asOf
    );
    expect(report.rows[0].openRappen).toBe(10000);
  });

  it("omits fully paid, draft, canceled and later-dated invoices", () => {
    const report = buildReceivables(
      [
        inv({ id: 1, state: "Paid", payments: [{ date: new Date("2026-03-01"), amount: dec(100) }] }),
        inv({ id: 2, state: "Draft" }),
        inv({ id: 3, state: "Canceled" }),
        inv({ id: 4, date: new Date("2027-01-02") }),
      ],
      asOf
    );
    expect(report.rows).toEqual([]);
  });

  it("reports overpayments as credit, not as open amount", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Paid", payments: [{ date: new Date("2026-03-01"), amount: dec(110) }] })],
      asOf
    );
    expect(report.rows[0]).toMatchObject({ openRappen: 0, creditRappen: 1000, bucket: null });
    expect(report.totalCreditRappen).toBe(1000);
    expect(report.totalOpenRappen).toBe(0);
  });

  it("sums per age bucket and per customer", () => {
    const report = buildReceivables(
      [
        inv({ id: 1, dueDate: new Date("2026-12-20") }), // d0_30
        inv({ id: 2, dueDate: new Date("2026-06-01"), customer: { ...customer, customerId: 2, company: "Zweite GmbH" } }), // d90plus
      ],
      asOf
    );
    expect(report.bucketTotals.d0_30).toBe(10000);
    expect(report.bucketTotals.d90plus).toBe(10000);
    expect(report.byCustomer.map((c) => [c.customerId, c.openRappen])).toEqual([
      [1, 10000],
      [2, 10000],
    ]);
  });

  it("subtracts credit notes dated up to the cut-off and keeps a credited invoice with a remainder", () => {
    const report = buildReceivables(
      [
        inv({
          id: 1,
          creditNotes: [
            { date: new Date("2026-03-01"), totalAmount: dec(-30) },
            { date: new Date("2027-01-15"), totalAmount: dec(-20) },
          ],
        }),
      ],
      asOf
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].openRappen).toBe(7000);
  });

  it("drops an invoice that credit notes settled completely", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Canceled", creditNotes: [{ date: new Date("2026-03-01"), totalAmount: dec(-100) }] })],
      asOf
    );
    expect(report.rows).toHaveLength(0);
  });

  it("still skips a legacy Canceled invoice without credit notes", () => {
    expect(buildReceivables([inv({ id: 1, state: "Canceled" })], asOf).rows).toHaveLength(0);
  });
});
