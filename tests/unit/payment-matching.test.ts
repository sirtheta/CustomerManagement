import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/payments", () => ({
  getPaymentSummary: vi.fn(),
  recordPayment: vi.fn(),
}));

import { matchAndMarkPaid } from "@/lib/payment-matching";
import prisma from "@/lib/prisma";
import { getPaymentSummary, recordPayment } from "@/lib/payments";

function summary(remainingRappen: number) {
  return { totalRappen: 0, paidRappen: 0, remainingRappen, overpaidRappen: 0 };
}

describe("matchAndMarkPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
      invoiceNumberPrefix: "R-",
    } as never);
  });

  it("records a budget-import payment on an exact documentNumber + remaining amount match", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 10, state: "Sent" } as never);
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(12345));

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
      bookingDate: "2026-07-05",
    });

    expect(result).toEqual({ matched: true, invoiceId: 10, documentNumber: "R-26070042" });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 10,
        amount: 123.45,
        date: new Date("2026-07-05"),
        source: "budget-import",
      }),
      prisma
    );
  });

  it("falls back to today when the booking date is invalid", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 10, state: "Sent" } as never);
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(12345));

    await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042",
      amountRappen: 12345,
      bookingDate: "not-a-date",
    });

    const call = vi.mocked(recordPayment).mock.calls[0][0];
    expect(isNaN(call.date.getTime())).toBe(false);
  });

  it("does not record a payment when the remaining amount does not match", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 10, state: "Sent" } as never);
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(99900));

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
    });

    expect(result).toEqual({ matched: false });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("returns unmatched when no candidate documentNumber is found in the description", async () => {
    const result = await matchAndMarkPaid({
      description: "Miete Juli",
      amountRappen: 250000,
    });

    expect(result).toEqual({ matched: false });
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("only considers Sent, Overdue and PartiallyPaid invoices", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
    });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: {
        documentNumber: "R-26070042",
        state: { in: ["Sent", "Overdue", "PartiallyPaid"] },
      },
    });
    expect(result).toEqual({ matched: false });
  });
});
