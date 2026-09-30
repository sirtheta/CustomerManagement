import { describe, it, expect, vi, beforeEach } from "vitest";

const dec = (n: number) => ({ toNumber: () => n });

const mockPrisma = vi.hoisted(() => ({
  payment: { aggregate: vi.fn(), findMany: vi.fn() },
  invoice: { findMany: vi.fn(), aggregate: vi.fn() },
  item: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
  customer: { findMany: vi.fn() },
}));
const mockSumOpen = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));
vi.mock("@/lib/payments", () => ({ sumOpenAmount: mockSumOpen }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { fetchAnalyticsData } from "@/app/(app)/analytics/lib/analytics-queries";

describe("fetchAnalyticsData (payment based)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _min: { date: null }, _max: { date: null } });
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockSumOpen.mockResolvedValue({ amount: 75.5, count: 2 });
  });

  it("derives revenue, monthly series, top customers and outstanding from payments", async () => {
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(200) } });
    mockPrisma.payment.findMany.mockResolvedValue([
      { date: new Date(2026, 2, 5, 12), amount: dec(40), invoice: { customerId: 1 } },
      { date: new Date(2026, 4, 2, 12), amount: dec(60), invoice: { customerId: 1 } },
      { date: new Date(2026, 4, 3, 12), amount: dec(100), invoice: { customerId: 2 } },
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { customerId: 1, company: "Eins AG", contactPerson: null, contactInsteadOfCompany: false },
      { customerId: 2, company: "Zwei AG", contactPerson: null, contactInsteadOfCompany: false },
    ]);

    const data = await fetchAnalyticsData(2026);

    expect(data.annualRevenue).toBe(200);
    expect(data.outstanding).toBe(75.5);
    expect(data.outstandingCount).toBe(2);
    expect(data.monthlyRevenue[2].amount).toBe(40);
    expect(data.monthlyRevenue[4].amount).toBe(160);
    expect(data.topCustomers.map((c) => [c.customerId, c.total])).toEqual([
      [1, 100],
      [2, 100],
    ]);
  });

  it("limits top customers to five, sorted by paid total", async () => {
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mockPrisma.payment.findMany.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((id) => ({
        date: new Date(2026, 0, 10, 12),
        amount: dec(id * 10),
        invoice: { customerId: id },
      })),
    );

    const data = await fetchAnalyticsData(2026);

    expect(data.annualRevenue).toBe(0);
    expect(data.topCustomers.map((c) => c.customerId)).toEqual([6, 5, 4, 3, 2]);
  });
});
