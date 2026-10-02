import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndUpdateAllDocumentStates, canTransitionInvoice, allowedInvoiceTargets, locksDraftWithoutMail } from "@/lib/state-manager";

const mockUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockPrisma = {
  invoice: { updateMany: mockUpdateMany },
  quote: { updateMany: mockUpdateMany },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkAndUpdateAllDocumentStates", () => {
  it("marks overdue invoices (no credit notes) and expired quotes", async () => {
    await checkAndUpdateAllDocumentStates(mockPrisma);
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: "Sent", creditNoteForId: null }),
        data: { state: "Overdue" },
      })
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: "Sent" }),
        data: { state: "Expired" },
      })
    );
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

describe("locksDraftWithoutMail", () => {
  it("is true when a draft is marked Sent, Paid or Overdue", () => {
    expect(locksDraftWithoutMail("Draft", "Sent")).toBe(true);
    expect(locksDraftWithoutMail("Draft", "Paid")).toBe(true);
    expect(locksDraftWithoutMail("Draft", "Overdue")).toBe(true);
  });

  it("is false when the draft stays a draft", () => {
    expect(locksDraftWithoutMail("Draft", "Draft")).toBe(false);
  });

  it("is false for invoices that are already out", () => {
    expect(locksDraftWithoutMail("Sent", "Paid")).toBe(false);
    expect(locksDraftWithoutMail("Overdue", "Sent")).toBe(false);
    expect(locksDraftWithoutMail("PartiallyPaid", "Paid")).toBe(false);
  });
});
