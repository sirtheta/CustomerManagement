import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Subscriptions of archived customers never run, so they must neither keep the
// Abos module switched on nor be touched by "Alle Abos pausieren".
const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/daily-jobs", () => ({ runDailyJobs: vi.fn() }));

import { pauseAllSubscriptions, setModule } from "@/app/(app)/settings/actions";

describe("subscriptions module blocker and archived customers", () => {
  const db = createTestDatabase();
  let activeId: number;
  let archivedId: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = {
      user: { id: "1", name: "Test", email: "t@example.com", role: "Admin" },
      expires: "2099-01-01",
    } as Session;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    activeId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
    archivedId = (
      await db.prisma.customer.create({
        data: { ...createValidTestCustomer(), contactPerson: "Archiv", archivedAt: new Date() },
      })
    ).customerId;
  });

  const subscription = (customerId: number) =>
    db.prisma.subscription.create({
      data: { customerId, interval: "Monthly", nextInvoiceDate: new Date("2026-12-01"), active: true },
    });

  it("lets the module be switched off when only archived customers have active subscriptions", async () => {
    await subscription(archivedId);

    expect(await setModule("subscriptions", false)).toEqual({ success: true });
  });

  it("still refuses while a non-archived customer has an active subscription", async () => {
    await subscription(archivedId);
    await subscription(activeId);

    const result = await setModule("subscriptions", false);

    expect(result.error).toContain("Es besteht noch 1 aktives Abo.");
  });

  it("pauses only subscriptions of non-archived customers", async () => {
    const archivedSub = await subscription(archivedId);
    const activeSub = await subscription(activeId);

    expect(await pauseAllSubscriptions()).toEqual({ success: true, paused: 1 });

    expect((await db.prisma.subscription.findUniqueOrThrow({ where: { id: activeSub.id } })).active).toBe(false);
    expect((await db.prisma.subscription.findUniqueOrThrow({ where: { id: archivedSub.id } })).active).toBe(true);
    expect(await setModule("subscriptions", false)).toEqual({ success: true });
  });
});
