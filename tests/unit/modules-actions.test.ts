import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { count: vi.fn() },
    pendingEmail: { count: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("@/lib/state-manager", () => ({ checkAndUpdateAllDocumentStates: vi.fn() }));
vi.mock("@/lib/reminders", () => ({ checkOverdueInvoices: vi.fn() }));
vi.mock("@/lib/subscriptions", () => ({ checkSubscriptions: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ closeAnsweredFollowUps: vi.fn(), notifyDueTasks: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ sendAdminNotifications: vi.fn() }));

import { saveModules } from "@/app/(app)/settings/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { MODULE_KEYS } from "@/lib/modules";

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

function form(on: readonly string[]): FormData {
  const fd = new FormData();
  for (const key of MODULE_KEYS) if (on.includes(key)) fd.set(`module_${key}`, "on");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(adminSession);
  vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(allOn as never);
  vi.mocked(prisma.subscription.count).mockResolvedValue(0);
  vi.mocked(prisma.pendingEmail.count).mockResolvedValue(0);
});

describe("saveModules", () => {
  it("stores every switch and writes one audit entry for the changed ones", async () => {
    const result = await saveModules({}, form(MODULE_KEYS.filter((k) => k !== "tasks" && k !== "quotes")));

    expect(result.success).toBe(true);
    expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
      where: { applicationSettingsId: 1 },
      data: {
        moduleTasks: false,
        moduleSubscriptions: true,
        moduleQuotes: false,
        moduleReminders: true,
        moduleBankImport: true,
        moduleAccounting: true,
        moduleAnalytics: true,
      },
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0].slice(1, 5)).toEqual(["UPDATE", "Settings", 1, "Module"]);
    expect(vi.mocked(logAudit).mock.calls[0][5]).toEqual({ Aufgaben: "aus", Offerten: "aus" });
  });

  it("does not audit when nothing changed", async () => {
    await saveModules({}, form(MODULE_KEYS));
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses to hide subscriptions while active subscriptions exist", async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValue(3);

    const result = await saveModules({}, form(MODULE_KEYS.filter((k) => k !== "subscriptions")));

    expect(result.error).toContain("3 aktive Abos");
    // the other switches the user changed come back, so the form keeps them
    expect(result.values).toMatchObject({ subscriptions: false, tasks: true, quotes: true });
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("refuses to hide subscriptions while drafts wait for approval", async () => {
    vi.mocked(prisma.pendingEmail.count).mockResolvedValue(2);

    const result = await saveModules({}, form(MODULE_KEYS.filter((k) => k !== "subscriptions")));

    expect(result.error).toContain("2 Abo-Rechnung");
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });

  it("does not check subscriptions when the module is already off", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ ...allOn, moduleSubscriptions: false } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(5);

    const result = await saveModules({}, form(MODULE_KEYS.filter((k) => k !== "subscriptions")));

    expect(result.success).toBe(true);
  });

  it("is admin only", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);

    await expect(saveModules({}, form(MODULE_KEYS))).rejects.toThrow();
    expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
  });
});
