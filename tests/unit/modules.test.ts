import { describe, it, expect, vi } from "vitest";
import {
  MODULE_KEYS,
  allModulesEnabled,
  getEnabledModules,
  isModuleEnabled,
  modulesFromSettings,
} from "@/lib/modules";

describe("modulesFromSettings", () => {
  it("has everything on without a settings row", () => {
    expect(modulesFromSettings(null)).toEqual(allModulesEnabled());
    expect(Object.keys(allModulesEnabled())).toEqual([...MODULE_KEYS]);
  });

  it("maps the settings columns to module keys", () => {
    const flags = modulesFromSettings({ moduleTasks: false, moduleQuotes: false });
    expect(flags.tasks).toBe(false);
    expect(flags.quotes).toBe(false);
    expect(flags.subscriptions).toBe(true);
    expect(flags.accounting).toBe(true);
  });
});

describe("getEnabledModules / isModuleEnabled", () => {
  it("reads the settings row through the given client", async () => {
    const findFirst = vi.fn().mockResolvedValue({ moduleSubscriptions: false });
    const prisma = { applicationSettings: { findFirst } } as never;

    expect((await getEnabledModules(prisma)).subscriptions).toBe(false);
    expect(await isModuleEnabled(prisma, "subscriptions")).toBe(false);
    expect(await isModuleEnabled(prisma, "tasks")).toBe(true);
  });
});
