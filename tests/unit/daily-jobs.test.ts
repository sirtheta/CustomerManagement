import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const {
  calls,
  checkAndUpdateAllDocumentStates,
  checkOverdueInvoices,
  checkSubscriptions,
  closeAnsweredFollowUps,
  notifyDueTasks,
  sendAdminNotifications,
  getEnabledModules,
} = vi.hoisted(() => {
  const calls: string[] = [];
  const step = (name: string) => vi.fn<(...args: unknown[]) => Promise<void>>(async () => { calls.push(name); });
  return {
    calls,
    checkAndUpdateAllDocumentStates: step("checkAndUpdateAllDocumentStates"),
    checkOverdueInvoices: step("checkOverdueInvoices"),
    checkSubscriptions: step("checkSubscriptions"),
    closeAnsweredFollowUps: step("closeAnsweredFollowUps"),
    notifyDueTasks: step("notifyDueTasks"),
    sendAdminNotifications: step("sendAdminNotifications"),
    getEnabledModules: vi.fn(),
  };
});

vi.mock("@/lib/state-manager", () => ({ checkAndUpdateAllDocumentStates }));
vi.mock("@/lib/reminders", () => ({ checkOverdueInvoices }));
vi.mock("@/lib/subscriptions", () => ({ checkSubscriptions }));
vi.mock("@/lib/tasks", () => ({ closeAnsweredFollowUps, notifyDueTasks }));
vi.mock("@/lib/notifications", () => ({ sendAdminNotifications }));
vi.mock("@/lib/modules", () => ({ getEnabledModules }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { runDailyJobs } from "@/lib/daily-jobs";

const settings = { applicationSettingsId: 1 };
const prisma = {
  applicationSettings: { findFirst: vi.fn(async () => settings) },
} as unknown as PrismaClient;

const allOn = { tasks: true, subscriptions: true, quotes: true, reminders: true, bankImport: true, accounting: true, analytics: true };

describe("runDailyJobs", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("runs every job in order when all modules are on", async () => {
    getEnabledModules.mockResolvedValue(allOn);
    expect(await runDailyJobs(prisma)).toEqual([]);
    expect(calls).toEqual([
      "checkAndUpdateAllDocumentStates",
      "checkOverdueInvoices",
      "checkSubscriptions",
      "closeAnsweredFollowUps",
      "notifyDueTasks",
      "sendAdminNotifications",
    ]);
    expect(notifyDueTasks).toHaveBeenCalledWith(prisma, settings);
    expect(sendAdminNotifications).toHaveBeenCalledWith(prisma, settings);
  });

  it("skips the jobs of switched-off modules", async () => {
    getEnabledModules.mockResolvedValue({ ...allOn, reminders: false, subscriptions: false, tasks: false });
    await runDailyJobs(prisma);
    expect(calls).toEqual(["checkAndUpdateAllDocumentStates", "sendAdminNotifications"]);
  });

  it("keeps going after a failing step and returns the failures", async () => {
    getEnabledModules.mockResolvedValue(allOn);
    checkSubscriptions.mockRejectedValueOnce(new Error("boom"));
    expect(await runDailyJobs(prisma)).toEqual([{ step: "checkSubscriptions", error: "boom" }]);
    expect(calls).toContain("sendAdminNotifications");
  });
});
