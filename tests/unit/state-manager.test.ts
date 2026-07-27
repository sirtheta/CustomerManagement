import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndUpdateDocumentStates } from "@/lib/state-manager";

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
