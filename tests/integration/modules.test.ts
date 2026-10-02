import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { createQuoteFollowUp } from "@/lib/tasks";
import { searchGlobal } from "@/lib/search";
import { getEnabledModules } from "@/lib/modules";

describe("switched-off modules", () => {
  const db = createTestDatabase();

  async function seedSettings(data: Record<string, boolean> = {}) {
    const company = await db.prisma.companyInformation.create({ data: { companyName: "Test AG" } });
    await db.prisma.applicationSettings.create({
      data: { companyInformationId: company.companyInformationId, ...data },
    });
  }

  async function seedQuote() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.quote.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "Q-0001",
        date: new Date(),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Sent",
      },
    });
  }

  it("has every module on by default (existing installations after the migration)", async () => {
    await seedSettings();
    expect(Object.values(await getEnabledModules(db.prisma)).every(Boolean)).toBe(true);
  });

  it("creates no follow-up task when tasks are off", async () => {
    await seedSettings({ moduleTasks: false });
    const quote = await seedQuote();

    await createQuoteFollowUp(db.prisma, { quoteId: quote.id });

    expect(await db.prisma.task.count()).toBe(0);
  });

  it("still creates the follow-up task when tasks are on", async () => {
    await seedSettings();
    const quote = await seedQuote();

    await createQuoteFollowUp(db.prisma, { quoteId: quote.id });

    expect(await db.prisma.task.count()).toBe(1);
  });

  it("leaves quotes out of the global search when quotes are off", async () => {
    await seedSettings({ moduleQuotes: false });
    await seedQuote();

    expect((await searchGlobal(db.prisma, "Q-0001")).quotes).toEqual([]);
  });

  it("finds quotes in the global search when quotes are on", async () => {
    await seedSettings();
    await seedQuote();

    expect((await searchGlobal(db.prisma, "Q-0001")).quotes).toHaveLength(1);
  });
});
