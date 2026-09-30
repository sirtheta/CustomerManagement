import { describe, expect, it, vi } from "vitest";
import { notifyBackupFailure, runBackupJob } from "@/lib/backup";

const settings = { notifyEmailAddress: "admin@example.com" } as never;

describe("notifyBackupFailure", () => {
  it("sends the error to the admin channels with a link to the logs page", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const loadSettings = vi.fn().mockResolvedValue(settings);

    expect(await notifyBackupFailure(new Error("disk full"), { loadSettings, notify })).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    const [passedSettings, subject, message, path] = notify.mock.calls[0];
    expect(passedSettings).toBe(settings);
    expect(subject).toContain("Backup");
    expect(message).toContain("disk full");
    expect(path).toBe("/settings/logs");
  });

  it("reports false when no channel is configured", async () => {
    const notify = vi.fn().mockResolvedValue(false);
    const loadSettings = vi.fn().mockResolvedValue(settings);
    expect(await notifyBackupFailure(new Error("x"), { loadSettings, notify })).toBe(false);
  });

  it("does nothing without settings", async () => {
    const notify = vi.fn();
    const loadSettings = vi.fn().mockResolvedValue(null);
    expect(await notifyBackupFailure(new Error("x"), { loadSettings, notify })).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws, even when loading settings or notifying fails", async () => {
    const failingLoad = vi.fn().mockRejectedValue(new Error("db locked"));
    expect(await notifyBackupFailure(new Error("x"), { loadSettings: failingLoad, notify: vi.fn() })).toBe(false);

    const failingNotify = vi.fn().mockRejectedValue(new Error("bad token"));
    const loadSettings = vi.fn().mockResolvedValue(settings);
    expect(await notifyBackupFailure(new Error("x"), { loadSettings, notify: failingNotify })).toBe(false);
  });
});

describe("runBackupJob", () => {
  it("creates a backup, then prunes, and does not notify", async () => {
    const create = vi.fn().mockReturnValue({ name: "db-2026-09-30.db", date: "2026-09-30", sizeBytes: 10 });
    const prune = vi.fn().mockReturnValue(0);
    const notify = vi.fn();

    expect(await runBackupJob({ create, prune, notify })).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(prune).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies and skips pruning when the backup fails", async () => {
    const err = new Error("no space left");
    const create = vi.fn(() => {
      throw err;
    });
    const prune = vi.fn();
    const notify = vi.fn().mockResolvedValue(true);

    expect(await runBackupJob({ create, prune, notify })).toBe(false);
    expect(notify).toHaveBeenCalledWith(err);
    expect(prune).not.toHaveBeenCalled();
  });

  it("still reports success when only pruning fails", async () => {
    const create = vi.fn().mockReturnValue({ name: "db-2026-09-30.db", date: "2026-09-30", sizeBytes: 10 });
    const prune = vi.fn(() => {
      throw new Error("EPERM");
    });
    const notify = vi.fn();

    expect(await runBackupJob({ create, prune, notify })).toBe(true);
    expect(prune).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });
});
