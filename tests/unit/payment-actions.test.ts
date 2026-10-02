import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/payments", () => ({
  getPaymentSummary: vi.fn(),
  recordPayment: vi.fn(),
  recordRemainingPayment: vi.fn(),
  deletePayment: vi.fn(),
  toRappen: (v: number) => Math.round(v * 100),
  PaymentError: class extends Error {},
}));

import { markInvoicePaidAction, recordPaymentAction } from "@/app/(app)/invoices/payments/actions";
import { auth } from "@/lib/auth";
import { getPaymentSummary, recordPayment, recordRemainingPayment } from "@/lib/payments";

const editorSession = {
  user: { id: "1", name: "Editor User", email: "editor@example.com", role: "Editor" },
} as never;

function summary(totalRappen: number, paidRappen: number, creditedRappen: number) {
  return {
    totalRappen,
    paidRappen,
    creditedRappen,
    remainingRappen: Math.max(totalRappen - creditedRappen - paidRappen, 0),
    overpaidRappen: Math.max(paidRappen + creditedRappen - totalRappen, 0),
  };
}

describe("recordPaymentAction overpayment check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
  });

  it("asks before booking more than is open after a credit note", async () => {
    // Invoice 1000, credit note 400, open 600: paying 1000 overpays by 400.
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(100_000, 0, 40_000));

    const res = await recordPaymentAction(1, "1000", "2026-03-01", false);

    expect(res).toEqual({ needsConfirmation: { overpaidBy: 400 } });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("books exactly the open remainder after a credit note without asking", async () => {
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(100_000, 10_000, 40_000));

    const res = await recordPaymentAction(1, "500", "2026-03-01", false);

    expect(res).toEqual({});
    expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 1, amount: 500 }));
  });

  it("books the overpayment once confirmed", async () => {
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(100_000, 0, 40_000));

    expect(await recordPaymentAction(1, "1000", "2026-03-01", true)).toEqual({});
    expect(recordPayment).toHaveBeenCalledOnce();
  });

  it("stores the form's calendar day as UTC midnight", async () => {
    vi.mocked(getPaymentSummary).mockResolvedValue(summary(100_000, 0, 0));

    await recordPaymentAction(1, "100", "2026-01-01", false);

    expect(vi.mocked(recordPayment).mock.calls[0][0].date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects a date that is not a calendar day", async () => {
    expect(await recordPaymentAction(1, "100", "2026-02-30", false)).toEqual({ error: "Ungültiges Datum." });
    expect(recordPayment).not.toHaveBeenCalled();
  });
});

describe("markInvoicePaidAction payment date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("books a payment at 00:30 on 1 January (Swiss time) in the new year", async () => {
    vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));

    expect(await markInvoicePaidAction(1)).toEqual({});

    const { date } = vi.mocked(recordRemainingPayment).mock.calls[0][0];
    expect(date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("books a payment at 23:30 on 31 December (Swiss time) in the old year", async () => {
    vi.setSystemTime(new Date("2025-12-31T22:30:00Z"));

    await markInvoicePaidAction(1);

    const { date } = vi.mocked(recordRemainingPayment).mock.calls[0][0];
    expect(date.toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });
});
