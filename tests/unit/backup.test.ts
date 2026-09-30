import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import {
  createBackup,
  listBackups,
  pruneBackups,
  resolveBackupFilePath,
} from "@/lib/backup";

const dirs: string[] = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), "customermanagement-backup-"));
  dirs.push(d);
  return d;
}

function makeDb(path: string, rows: string[]) {
  const db = new Database(path);
  db.exec("CREATE TABLE t (v TEXT)");
  const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
  for (const r of rows) ins.run(r);
  db.close();
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("createBackup", () => {
  it("writes a valid SQLite copy named after the date", () => {
    const src = tmpDir();
    const out = tmpDir();
    makeDb(join(src, "app.db"), ["a", "b"]);

    const info = createBackup({ dbPath: join(src, "app.db"), dir: out, now: new Date(2026, 8, 30) });

    expect(info.name).toBe("db-2026-09-30.db");
    expect(info.date).toBe("2026-09-30");
    expect(info.sizeBytes).toBeGreaterThan(0);
    const copy = new Database(join(out, info.name), { readonly: true });
    expect(copy.prepare("SELECT v FROM t ORDER BY v").all()).toEqual([{ v: "a" }, { v: "b" }]);
    copy.close();
  });

  it("replaces an earlier backup of the same day and leaves no .tmp behind", () => {
    const src = tmpDir();
    const out = tmpDir();
    makeDb(join(src, "app.db"), ["a"]);
    const now = new Date(2026, 8, 30);
    createBackup({ dbPath: join(src, "app.db"), dir: out, now });

    const db = new Database(join(src, "app.db"));
    db.prepare("INSERT INTO t (v) VALUES ('b')").run();
    db.close();
    createBackup({ dbPath: join(src, "app.db"), dir: out, now });

    expect(readdirSync(out)).toEqual(["db-2026-09-30.db"]);
    const copy = new Database(join(out, "db-2026-09-30.db"), { readonly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    copy.close();
  });

  it("throws and keeps the existing backup when the source is missing", () => {
    const out = tmpDir();
    writeFileSync(join(out, "db-2026-09-29.db"), "old backup");

    expect(() =>
      createBackup({ dbPath: join(out, "missing.db"), dir: out, now: new Date(2026, 8, 30) })
    ).toThrow();

    expect(readdirSync(out).sort()).toEqual(["db-2026-09-29.db"]);
  });

  it("throws when the target directory cannot be created", () => {
    const src = tmpDir();
    const out = tmpDir();
    makeDb(join(src, "app.db"), ["a"]);
    writeFileSync(join(out, "blocker"), "a file, not a directory");

    expect(() =>
      createBackup({ dbPath: join(src, "app.db"), dir: join(out, "blocker") })
    ).toThrow();
  });
});

describe("listBackups", () => {
  it("returns an empty list when the directory does not exist", () => {
    expect(listBackups(join(tmpdir(), "does-not-exist-" + Date.now()))).toEqual([]);
  });

  it("lists valid backups newest first and ignores everything else", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "db-2026-09-01.db"), "x");
    writeFileSync(join(dir, "db-2026-09-28.db"), "yy");
    writeFileSync(join(dir, "db-2026-09-29.db.tmp"), "half");
    writeFileSync(join(dir, "notes.txt"), "ignored");

    const list = listBackups(dir);

    expect(list.map((b) => b.name)).toEqual(["db-2026-09-28.db", "db-2026-09-01.db"]);
    expect(list[0]).toEqual({ name: "db-2026-09-28.db", date: "2026-09-28", sizeBytes: 2 });
  });
});

describe("pruneBackups", () => {
  it("deletes backups older than keepDays and keeps the rest", () => {
    const dir = tmpDir();
    for (const n of ["db-2026-08-01.db", "db-2026-08-31.db", "db-2026-09-15.db", "db-2026-09-30.db"]) {
      writeFileSync(join(dir, n), "x");
    }

    const deleted = pruneBackups(dir, 30, new Date(2026, 8, 30));

    expect(deleted).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(["db-2026-08-31.db", "db-2026-09-15.db", "db-2026-09-30.db"]);
  });

  it("keeps the same days regardless of the time of day the job runs", () => {
    const dir = tmpDir();
    for (const n of ["db-2026-08-30.db", "db-2026-08-31.db", "db-2026-09-30.db"]) {
      writeFileSync(join(dir, n), "x");
    }

    // The real job runs at 02:15, not midnight; the cutoff is a calendar day
    // (like pruneOldLogs), so 08-31 survives either way.
    pruneBackups(dir, 30, new Date(2026, 8, 30, 2, 15));

    expect(readdirSync(dir).sort()).toEqual(["db-2026-08-31.db", "db-2026-09-30.db"]);
  });

  it("always keeps the newest backup, even when it is older than keepDays", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "db-2026-01-01.db"), "x");
    writeFileSync(join(dir, "db-2026-01-02.db"), "x");

    pruneBackups(dir, 30, new Date(2026, 8, 30));

    expect(readdirSync(dir)).toEqual(["db-2026-01-02.db"]);
  });

  it("keeps everything when keepDays is 0", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "db-2020-01-01.db"), "x");
    writeFileSync(join(dir, "db-2026-09-30.db"), "x");

    expect(pruneBackups(dir, 0, new Date(2026, 8, 30))).toBe(0);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it("removes orphaned .tmp files but not unrelated files", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "db-2026-09-29.db.tmp"), "half");
    writeFileSync(join(dir, "db-2026-09-30.db"), "x");
    writeFileSync(join(dir, "notes.txt"), "keep me");

    pruneBackups(dir, 30, new Date(2026, 8, 30));

    expect(readdirSync(dir).sort()).toEqual(["db-2026-09-30.db", "notes.txt"]);
  });

  it("returns 0 when the directory does not exist", () => {
    expect(pruneBackups(join(tmpdir(), "does-not-exist-" + Date.now()), 30)).toBe(0);
  });
});

describe("resolveBackupFilePath", () => {
  it("accepts only the exact db-YYYY-MM-DD.db shape", () => {
    expect(resolveBackupFilePath("db-2026-09-30.db", "/x")).toBe(join("/x", "db-2026-09-30.db"));
    for (const bad of [
      "../db-2026-09-30.db",
      "..\db-2026-09-30.db",
      "/etc/passwd",
      "db-2026-09-30.db.tmp",
      "db-2026-9-30.db",
      "db-2026-09-30.sqlite",
      "app.db",
      "",
    ]) {
      expect(resolveBackupFilePath(bad, "/x")).toBeNull();
    }
  });
});
