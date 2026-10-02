import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    pendingEmail: { count: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("@/lib/daily-jobs", () => ({ runDailyJobs: vi.fn() }));

import { pauseAllSubscriptions, setModule, setSetting } from "@/app/(app)/settings/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

const adminSession = {
  user: { id: "1", name: "Admin", email: "admin@test.ch", role: "Admin" },
} as never;
const editorSession = {
  user: { id: "2", name: "Editor", email: "editor@test.ch", role: "Editor" },
} as never;

const allOn = {
  applicationSettingsId: 1,
  moduleTasks: true,
  moduleSubscriptions: true,
  moduleQuotes: true,
  moduleReminders: true,
  moduleBankImport: true,
  moduleAccounting: true,
  moduleAnalytics: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(adminSession);
  vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(allOn as never);
  vi.mocked(prisma.subscription.count).mockResolvedValue(0);
  vi.mocked(prisma.pendingEmail.count).mockResolvedValue(0);
});

describe("setModule", () => {
  it("switches one module off and audits it", async () => {
    const result = await setModule("tasks", false);

    expect(result).toEqual({ success: true });
    expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
      where: { applicationSettingsId: 1 },
      data: { moduleTasks: false },
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0].slice(1, 6)).toEqual(["UPDATE", "Settings", 1, "Module", { Aufgaben: "aus" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("switches a module back on", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ ...allOn, moduleQuotes: false } as never);

    const result = await setModule("quotes", true);

    expect(result.success).toBe(true);
    expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
      where: { applicationSettingsId: 1 },
      data: { moduleQuotes: true },
    });
    expect(vi.mocked(logAudit).mock.calls[0][5]).toEqual({ Offerten: "ein" });
  });

  it("does nothing and does not audit when the module already has that state", async () => {
    const result = await setModule("tasks", true);

    expect(result.success).toBe(true);
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses to switch subscriptions off while active subscriptions exist", async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValue(3);

    const result = await setModule("subscriptions", false);

    expect(result.error).toContain("3 aktive Abos");
    expect(result.error).toContain("bleibt eingeschaltet");
    expect(result.error).toContain("Alle Abos pausieren");
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses to switch subscriptions off while drafts wait for approval", async () => {
    vi.mocked(prisma.pendingEmail.count).mockResolvedValue(2);

    const result = await setModule("subscriptions", false);

    expect(result.error).toContain("2 Abo-Rechnung");
    expect(result.error).toContain("Ausstehende E-Mails");
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("does not check subscriptions when the module is already off", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ ...allOn, moduleSubscriptions: false } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(5);

    const result = await setModule("subscriptions", false);

    expect(result.success).toBe(true);
    expect(prisma.subscription.count).not.toHaveBeenCalled();
  });

  it("does not check subscriptions when switching it on", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ ...allOn, moduleSubscriptions: false } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(5);

    const result = await setModule("subscriptions", true);

    expect(result.success).toBe(true);
    expect(prisma.subscription.count).not.toHaveBeenCalled();
  });

  it("rejects an unknown module key", async () => {
    const result = await setModule("billing", false);

    expect(result.error).toBeDefined();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("reports missing settings", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);

    expect((await setModule("tasks", false)).error).toBeDefined();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("is admin only", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);

    await expect(setModule("tasks", false)).rejects.toThrow();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });
});

describe("pauseAllSubscriptions", () => {
  it("pauses all active subscriptions and audits each one", async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: 4, customerId: 10 },
      { id: 7, customerId: 11 },
    ] as never);
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 2 } as never);

    const result = await pauseAllSubscriptions();

    expect(result).toEqual({ success: true, paused: 2 });
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, customerId: true },
    });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [4, 7] }, active: true },
      data: { active: false },
    });
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logAudit).mock.calls[0].slice(1, 6)).toEqual([
      "UPDATE", "Subscription", 4, undefined, { customerId: 10, active: false },
    ]);
    expect(vi.mocked(logAudit).mock.calls[1].slice(3, 4)).toEqual([7]);
    expect(revalidatePath).toHaveBeenCalledWith("/subscriptions");
  });

  it("lets the module be switched off afterwards", async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);

    expect((await setModule("subscriptions", false)).success).toBe(true);
  });

  it("does nothing when no subscription is active", async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

    const result = await pauseAllSubscriptions();

    expect(result).toEqual({ success: true, paused: 0 });
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does not touch pending drafts", async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([{ id: 1, customerId: 1 }] as never);
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.pendingEmail.count).mockResolvedValue(2);

    await pauseAllSubscriptions();
    const refused = await setModule("subscriptions", false);

    expect(refused.error).toContain("2 Abo-Rechnung");
  });

  it("is admin only", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);

    await expect(pauseAllSubscriptions()).rejects.toThrow();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });
});

describe("setSetting", () => {
  const stored = { applicationSettingsId: 1, useHolderNameOnQR: false, roundTotalTo5Rappen: false, notifyOverdueEnabled: false, notifyPendingEnabled: false };

  beforeEach(() => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(stored as never);
  });

  it("saves the rounding switch and audits it as Rundung", async () => {
    const result = await setSetting("roundTotalTo5Rappen", true);

    expect(result).toEqual({ success: true });
    expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
      where: { applicationSettingsId: 1 },
      data: { roundTotalTo5Rappen: true },
    });
    expect(logAudit).toHaveBeenCalledWith(adminSession, "UPDATE", "Settings", 1, "Rundung", {
      roundTotalTo5Rappen: true,
    });
  });

  it("does not audit the other switches", async () => {
    for (const key of ["useHolderNameOnQR", "notifyOverdueEnabled", "notifyPendingEnabled"]) {
      expect((await setSetting(key, true)).success).toBe(true);
    }
    expect(prisma.applicationSettings.update).toHaveBeenCalledTimes(3);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does nothing when the value is unchanged", async () => {
    await setSetting("roundTotalTo5Rappen", false);

    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("only accepts the whitelisted switches", async () => {
    for (const key of ["smtpPassword", "defaultPaymentTermDays", "toString"]) {
      expect((await setSetting(key, true)).error).toBeDefined();
    }
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("asks to save the settings first when there is no row yet", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);

    expect((await setSetting("roundTotalTo5Rappen", true)).error).toBeDefined();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("is admin only", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);

    await expect(setSetting("roundTotalTo5Rappen", true)).rejects.toThrow();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });
});
