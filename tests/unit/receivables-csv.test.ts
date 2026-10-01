import { describe, it, expect } from "vitest";
import { buildReceivables } from "@/lib/receivables";
import { receivablesCsv, RECEIVABLES_HEADERS } from "@/lib/receivables-csv";

const dec = (n: number) => ({ toNumber: () => n });

describe("receivablesCsv", () => {
  it("lists each open invoice with the customer address", () => {
    const report = buildReceivables(
      [
        {
          id: 1,
          documentNumber: "I-26010001",
          state: "Sent",
          date: new Date("2026-01-10"),
          dueDate: new Date("2026-02-10"),
          totalAmount: dec(100),
          customer: {
            customerId: 1,
            company: "Muster AG",
            contactPerson: "Anna",
            contactInsteadOfCompany: false,
            street: "Seestrasse",
            houseNumber: "100",
            zipCode: "3011",
            city: "Bern",
            country: "CH",
          },
          payments: [{ date: new Date("2026-03-01"), amount: dec(30) }],
        },
      ],
      new Date("2026-12-31")
    );
    const lines = receivablesCsv(report).split("\n");
    expect(lines[0]).toBe(RECEIVABLES_HEADERS.join(","));
    expect(lines[1]).toBe(
      "I-26010001,Muster AG,Seestrasse 100,3011,Bern,Schweiz,10.1.2026,10.2.2026,100.00,30.00,70.00,0.00,über 90 Tage"
    );
  });

  it("writes only the header for an empty report", () => {
    expect(receivablesCsv(buildReceivables([], new Date("2026-12-31")))).toBe(RECEIVABLES_HEADERS.join(","));
  });
});
