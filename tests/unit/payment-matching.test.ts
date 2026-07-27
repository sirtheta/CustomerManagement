import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { matchAndMarkPaid } from "@/lib/payment-matching";
import prisma from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

describe("matchAndMarkPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
      invoiceNumberPrefix: "R-",
    } as never);
  });

  it("marks the invoice Paid on an exact documentNumber + amount match", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: 10,
      state: "Sent",
      totalAmount: 123.45,
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
    });

    expect(result).toEqual({ matched: true, invoiceId: 10, documentNumber: "R-26070042" });
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { state: "Paid", paidDate: expect.any(Date) },
    });
    expect(logAudit).toHaveBeenCalled();
  });

  it("does not mark paid when the amount does not match", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: 10,
      state: "Sent",
      totalAmount: 999.0,
    } as never);

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
    });

    expect(result).toEqual({ matched: false });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("returns unmatched when no candidate documentNumber is found in the description", async () => {
    const result = await matchAndMarkPaid({
      description: "Miete Juli",
      amountRappen: 250000,
    });

    expect(result).toEqual({ matched: false });
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("ignores invoices that are already Paid", async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

    const result = await matchAndMarkPaid({
      description: "Zahlung Rechnung R-26070042 danke",
      amountRappen: 12345,
    });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { documentNumber: "R-26070042", state: { not: "Paid" } },
    });
    expect(result).toEqual({ matched: false });
  });
});
