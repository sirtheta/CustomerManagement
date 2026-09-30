import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndUpdateDocumentStates, canTransitionInvoice, allowedInvoiceTargets } from "@/lib/state-manager";

const mockUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrisma = {
  invoice: { updateMany: mockUpdateMany },
  quote: { updateMany: mockUpdateMany },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkAndUpdateDocumentStates", () => {
  it("calls updateMany for overdue invoices", async () => {
    await checkAndUpdateDocumentStates(mockPrisma, [1, 2], []);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [1, 2] }, state: "Sent" }),
        data: { state: "Overdue" },
      })
    );
  });

  it("calls updateMany for expired quotes", async () => {
    await checkAndUpdateDocumentStates(mockPrisma, [], [10, 11]);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [10, 11] }, state: "Sent" }),
        data: { state: "Expired" },
      })
    );
  });

  it("skips invoice query when invoiceIds is empty", async () => {
    await checkAndUpdateDocumentStates(mockPrisma, [], []);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe("canTransitionInvoice", () => {
  it.each([
    ["Draft", "Sent"],
    ["Draft", "Paid"],
    ["Sent", "Overdue"],
    ["Sent", "Paid"],
    ["Overdue", "Sent"],
    ["Overdue", "Paid"],
    ["PartiallyPaid", "Paid"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(true);
  });

  it.each([
    ["Draft", "Overdue"],
    ["Draft", "Canceled"],
    ["Sent", "Draft"],
    ["Sent", "Canceled"],
    ["Overdue", "Canceled"],
    ["Paid", "Sent"],
    ["Paid", "Draft"],
    ["PartiallyPaid", "Sent"],
    ["Canceled", "Sent"],
    ["Canceled", "Paid"],
  ] as const)("refuses %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(false);
  });

  it("treats staying in the same state as allowed", () => {
    expect(canTransitionInvoice("Canceled", "Canceled")).toBe(true);
  });

  it("lists the current state plus the allowed targets", () => {
    expect(allowedInvoiceTargets("Sent")).toEqual(["Sent", "Overdue", "Paid"]);
    expect(allowedInvoiceTargets("Canceled")).toEqual(["Canceled"]);
  });
});
