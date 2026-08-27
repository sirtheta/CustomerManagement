import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listLogFiles, pruneOldLogs, resolveLogFilePath, rotateLogs } from "@/lib/logs";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "customermanagement-logs-"));
}

describe("listLogFiles", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the directory does not exist", () => {
    expect(listLogFiles(join(tmpdir(), "does-not-exist-" + Date.now()))).toEqual([]);
  });

  it("lists the current file first, then rotated files newest first", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app.log"), "current\n");
    writeFileSync(join(dir, "app-2026-07-01.log"), "old\n");
    writeFileSync(join(dir, "app-2026-07-28.log"), "newer\n");
    writeFileSync(join(dir, "not-a-log.txt"), "ignored");

    const files = listLogFiles(dir);

    expect(files.map((f) => f.name)).toEqual(["app.log", "app-2026-07-28.log", "app-2026-07-01.log"]);
    expect(files[0].current).toBe(true);
    expect(files[1].current).toBe(false);
  });
});

describe("rotateLogs", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("copies today's-not-yet-rotated content to yesterday's file and truncates the current one", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app.log"), "line one\nline two\n");
    const now = new Date("2026-07-29T02:35:00Z");

    const target = rotateLogs({ dir, maxKeepDays: 0, now });

    expect(target).toBe(join(dir, "app-2026-07-28.log"));
    expect(readFileSync(target!, "utf8")).toBe("line one\nline two\n");
    expect(readFileSync(join(dir, "app.log"), "utf8")).toBe("");
  });

  it("does nothing when the current file is empty or missing", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app.log"), "");
    const now = new Date("2026-07-29T02:35:00Z");

    expect(rotateLogs({ dir, maxKeepDays: 0, now })).toBeNull();
    expect(existsSync(join(dir, "app-2026-07-28.log"))).toBe(false);
  });

  it("prunes old rotated files as part of rotation", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app.log"), "fresh entry\n");
    writeFileSync(join(dir, "app-2020-01-01.log"), "ancient");
    const now = new Date("2026-07-29T02:35:00Z");

    rotateLogs({ dir, maxKeepDays: 14, now });

    expect(existsSync(join(dir, "app-2020-01-01.log"))).toBe(false);
  });
});

describe("pruneOldLogs", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes only rotated files older than the retention window", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app-2026-07-01.log"), "");
    writeFileSync(join(dir, "app-2026-07-28.log"), "");
    writeFileSync(join(dir, "app.log"), ""); // never pruned — it's the live file
    const now = new Date("2026-07-29T00:00:00Z");

    const deleted = pruneOldLogs(dir, 14, now);

    expect(deleted).toBe(1);
    expect(existsSync(join(dir, "app-2026-07-01.log"))).toBe(false);
    expect(existsSync(join(dir, "app-2026-07-28.log"))).toBe(true);
    expect(existsSync(join(dir, "app.log"))).toBe(true);
  });

  it("keeps everything when maxKeepDays is 0", () => {
    dir = tmpDir();
    writeFileSync(join(dir, "app-2000-01-01.log"), "");
    expect(pruneOldLogs(dir, 0)).toBe(0);
    expect(existsSync(join(dir, "app-2000-01-01.log"))).toBe(true);
  });
});

describe("resolveLogFilePath", () => {
  it("accepts the current file and the exact rotated-file shape", () => {
    expect(resolveLogFilePath("app.log")).toBeTruthy();
    expect(resolveLogFilePath("app-2026-07-28.log", "/data/logs")).toBe(join("/data/logs", "app-2026-07-28.log"));
  });

  it("rejects anything else, including path traversal attempts", () => {
    expect(resolveLogFilePath("../../.env")).toBeNull();
    expect(resolveLogFilePath("app-2026-07-28.log.bak")).toBeNull();
    expect(resolveLogFilePath("app.log/../../secrets.json")).toBeNull();
    expect(resolveLogFilePath("")).toBeNull();
  });
});
