# F4 Teil C: Automatisches nächtliches Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App sichert die SQLite-Datenbank jede Nacht als konsistenten Snapshot, hält die Backups konfigurierbar vor, meldet Fehler über die Admin-Benachrichtigungskanäle (E-Mail, Telegram) und zeigt die Backups in Einstellungen → Logs zum Download.

**Architecture:** Neues Modul `lib/backup.ts` (Struktur wie `lib/logs.ts`): `createBackup` (`VACUUM INTO` in `.tmp`, dann atomar umbenennen), `pruneBackups`, `listBackups`, `resolveBackupFilePath`, `notifyBackupFailure` (über alle konfigurierten Admin-Kanäle, E-Mail und Telegram, via neuem `notifyAdmins` in `lib/notifications.ts`) und `startBackupScheduler` (node-cron, gestartet in `instrumentation.ts`). Der DB-Pfad kommt aus einem neuen, abhängigkeitsfreien `lib/db-path.ts`, das `lib/prisma.ts` und `lib/log-capture.ts` ebenfalls nutzen. Download über `GET /api/backups/[filename]` (Admin-only). Kein neues Prisma-Modell, keine Migration.

**Tech Stack:** Next.js 16, better-sqlite3 (direkt, wie `app/api/export/database/route.ts`), node-cron, Vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-30-f4c-automatisches-backup-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Doku auf Deutsch, ausser `CLAUDE.md` (englisch, wie die bestehende Datei). Commit-Messages auf Englisch (Conventional Commits, z. B. `feat(backup): ...`), Commits enden mit der Co-Authored-By-Zeile des ausführenden Modells (z. B. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).
- Jeder Commit ist grün: `npx tsc --noEmit` und die bis dahin betroffenen Tests laufen durch.
- `lib/backup.ts` darf `lib/logger` erst importieren, wenn `startLogCapture()` gelaufen ist. Deshalb wird es in `instrumentation.ts` per dynamischem `import()` **nach** `startLogCapture()` geladen (siehe CLAUDE.md, Abschnitt Logs).
- `lib/backup.ts` importiert **nicht** `lib/prisma` und **nicht** `lib/notifications` statisch: Seite und Route laden `lib/backup.ts` nur für Liste und Download und sollen dafür weder einen Prisma-Client noch die Notification-Kette (State-Manager, Mahnungen, Jahresrechnungen) mitziehen. Den DB-Pfad liefert `getDbPath()` aus `lib/db-path.ts` (Task 1). Prisma und `notifyAdmins` werden nur im Fehlerpfad per dynamischem `import()` geladen. Hinweis: `tests/setup.ts` mockt `@/lib/prisma` global mit nur einem `default`-Export, ein `getDbPath` aus `lib/prisma` wäre in Tests `undefined`.
- Datumsformat überall über `toDateString` aus `lib/date.ts` (lokale Zeit), keine eigene Hilfsfunktion.
- Backup-Dateiname exakt `db-YYYY-MM-DD.db` (Serverzeit; im Docker-Container ohne `TZ` ist das UTC). Nur dieses Muster ist gültig, gilt für Liste, Pruning und Download.
- Konfiguration (alle optional): `BACKUP_DIR` (Standard `<Verzeichnis der DB-Datei>/backups`), `BACKUP_CRON_SCHEDULE` (Standard `15 2 * * *`), `BACKUP_KEEP_DAYS` (Standard `30`, `0` = alles behalten), `DISABLE_BACKUP` (`true` schaltet ab).
- Ausser Umfang: Verschlüsselung, Cloud-Upload, Restore-UI, Backup von `data/archive/` (kommt mit Teil A), Audit-Eintrag für Backups, Drosselung der Fehlermeldung (der Job läuft einmal pro Nacht, also höchstens eine Meldung pro Tag; eine In-Memory-Drossel brächte nur bei einem häufigeren `BACKUP_CRON_SCHEDULE` etwas).
- Tests: `npx vitest run <datei>`. Unit-Tests für `lib/backup.ts` legen echte SQLite-Dateien in Temp-Verzeichnissen mit `better-sqlite3` an (kein Prisma nötig).
- Next.js 16: vor Änderungen an Routing/Datenabruf `node_modules/next/dist/docs/` prüfen. Die Route folgt dem bestehenden Muster in `app/api/logs/[filename]/route.ts` (`params` ist ein `Promise`).

---

### Task 1: Backup-Kern (`lib/backup.ts`) und Konfiguration

**Files:**
- Create: `lib/db-path.ts`
- Modify: `lib/prisma.ts`, `lib/log-capture.ts` (nutzen `lib/db-path.ts`)
- Modify: `lib/config.ts` (Abschnitt `backup` ergänzen)
- Create: `lib/backup.ts`
- Test: `tests/unit/backup.test.ts`

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces (von Task 2–4 genutzt):
  - `getDbPath(): string` aus `lib/db-path.ts` (von `lib/prisma` weiterhin re-exportiert)
  - `type BackupFileInfo = { name: string; date: string; sizeBytes: number }` (`date` = `YYYY-MM-DD`)
  - `getBackupDir(): string`
  - `createBackup(options?: { dbPath?: string; dir?: string; now?: Date }): BackupFileInfo` (synchron, wirft bei Fehler)
  - `listBackups(dir?: string): BackupFileInfo[]` (neueste zuerst)
  - `pruneBackups(dir: string, keepDays: number, now?: Date): number` (Anzahl gelöschter Backups)
  - `resolveBackupFilePath(filename: string, dir?: string): string | null`
  - `config.backup.cronSchedule: string`, `config.backup.keepDays: number`

- [ ] **Step 0: DB-Pfad in `lib/db-path.ts` zusammenführen**

Die `DATABASE_URL`-Auswertung steht heute zweimal (`lib/prisma.ts` `getDbPath`, `lib/log-capture.ts` `getLogDir`); `lib/backup.ts` wäre die dritte Kopie. Neue Datei `lib/db-path.ts`:

```ts
/**
 * SQLite database file path from DATABASE_URL. Deliberately dependency-free:
 * lib/log-capture.ts (which must not construct the pino logger) and
 * lib/backup.ts (which must not instantiate the Prisma client at import time)
 * both need it without pulling in lib/prisma.
 */
export function getDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/customermanagement.db";
  return url.replace(/^file:/, "");
}
```

In `lib/prisma.ts` die lokale Funktion `getDbPath` ersetzen durch:

```ts
import { getDbPath } from "@/lib/db-path";

export { getDbPath };
```

(`app/api/export/database/route.ts` importiert `getDbPath` weiter aus `@/lib/prisma` und bleibt unverändert.)

In `lib/log-capture.ts` `getLogDir` auf `getDbPath()` umstellen und den Kommentar anpassen:

```ts
import { getDbPath } from "@/lib/db-path";

/**
 * Log file directory, next to the SQLite database (inside the data volume in
 * Docker, so it survives restarts). Uses lib/db-path rather than lib/prisma's
 * re-export — lib/prisma instantiates the Prisma client at import time, which
 * this module (imported first thing in instrumentation.ts, see
 * startLogCapture) has no reason to force this early.
 */
function getLogDir(): string {
  return join(dirname(getDbPath()), "logs");
}
```

Danach `npx vitest run tests/integration/logs-route.test.ts tests/unit` kurz laufen lassen: das Verhalten ist unverändert.

- [ ] **Step 1: Konfiguration ergänzen**

In `lib/config.ts` direkt nach dem Block `logs: { ... },` einfügen:

```ts
  backup: {
    // Nightly SQLite snapshot (<data>/backups/db-<date>.db). Offset from the
    // 02:35 log rotation so the two jobs never run at the same moment.
    cronSchedule: process.env.BACKUP_CRON_SCHEDULE || "15 2 * * *",
    // Days to keep backups; 0 keeps all (same reasoning as logs.maxKeepDays).
    keepDays: (() => {
      const parsed = parseInt(process.env.BACKUP_KEEP_DAYS ?? "", 10);
      return Number.isFinite(parsed) ? parsed : 30;
    })(),
  },
```

- [ ] **Step 2: Failing Tests schreiben**

`tests/unit/backup.test.ts`:

```ts
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
      "..\\db-2026-09-30.db",
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
```

- [ ] **Step 3: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/backup.test.ts`
Expected: FAIL (`Cannot find module '@/lib/backup'`).

- [ ] **Step 4: `lib/backup.ts` implementieren**

```ts
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { dirname, join } from "path";
import logger from "@/lib/logger";
import { toDateString } from "@/lib/date";
import { getDbPath } from "@/lib/db-path";

const log = logger.child({ module: "backup" });

const BACKUP_RE = /^db-(\d{4}-\d{2}-\d{2})\.db$/;
const TMP_RE = /^db-\d{4}-\d{2}-\d{2}\.db\.tmp$/;

export type BackupFileInfo = { name: string; date: string; sizeBytes: number };

/** Read at call time (not import time) so BACKUP_DIR changes are picked up, e.g. in tests. */
export function getBackupDir(): string {
  return process.env.BACKUP_DIR || join(dirname(getDbPath()), "backups");
}

/**
 * Snapshots the database with `VACUUM INTO` (consistent point-in-time copy
 * even while the app writes — same technique as app/api/export/database).
 * Writes to `<name>.tmp` first and renames, so a crash or full disk never
 * leaves a half-written file that looks like a valid backup. A second run on
 * the same day replaces the earlier file.
 *
 * Synchronous (better-sqlite3), so it blocks the event loop for as long as
 * the copy takes — attachments and the logo live in the database, so on a
 * Pi's SD card that can be seconds. Acceptable for a nightly job.
 */
export function createBackup(
  options: { dbPath?: string; dir?: string; now?: Date } = {}
): BackupFileInfo {
  const dbPath = options.dbPath ?? getDbPath();
  const dir = options.dir ?? getBackupDir();
  const date = toDateString(options.now ?? new Date());
  const name = `db-${date}.db`;
  const target = join(dir, name);
  const tmp = `${target}.tmp`;

  mkdirSync(dir, { recursive: true });
  rmSync(tmp, { force: true });
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.prepare("VACUUM INTO ?").run(tmp);
    } finally {
      db.close();
    }
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return { name, date, sizeBytes: statSync(target).size };
}

/** Valid backups in `dir`, newest first. Empty when the directory does not exist. */
export function listBackups(dir: string = getBackupDir()): BackupFileInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, match: BACKUP_RE.exec(name) }))
    .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null)
    .map(({ name, match }) => ({
      name,
      date: match[1],
      sizeBytes: statSync(join(dir, name)).size,
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Deletes backups older than `keepDays` (0 keeps all) and orphaned `.tmp`
 * files. The newest backup is never deleted, so a broken job can't prune its
 * way to zero backups. Returns the number of deleted backups.
 *
 * The cutoff is a calendar day compared as a string (like pruneOldLogs), so
 * the result doesn't depend on the time of day the job runs.
 */
export function pruneBackups(dir: string, keepDays: number, now: Date = new Date()): number {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir);

  for (const file of files) {
    if (TMP_RE.test(file)) rmSync(join(dir, file), { force: true });
  }
  if (keepDays <= 0) return 0;

  const backups = files.filter((f) => BACKUP_RE.test(f)).sort().reverse();
  const cutoff = toDateString(new Date(now.getTime() - keepDays * 86_400_000));
  let deleted = 0;
  for (const file of backups.slice(1)) {
    if (BACKUP_RE.exec(file)![1] < cutoff) {
      rmSync(join(dir, file), { force: true });
      deleted++;
    }
  }
  if (deleted > 0) log.info({ deleted, keepDays }, "Pruned old backups");
  return deleted;
}

/** Resolves a downloadable backup's absolute path, or `null` for anything but the exact db-YYYY-MM-DD.db shape. */
export function resolveBackupFilePath(filename: string, dir: string = getBackupDir()): string | null {
  return BACKUP_RE.test(filename) ? join(dir, filename) : null;
}
```

- [ ] **Step 5: Tests laufen lassen, müssen bestehen**

Run: `npx vitest run tests/unit/backup.test.ts`
Expected: PASS (alle Tests). Falls `db.prepare("VACUUM INTO ?")` auf der read-only-Verbindung fehlschlägt, wäre `app/api/export/database/route.ts` betroffen. Dort läuft dieselbe Zeile, sie funktioniert.

- [ ] **Step 6: Typprüfung und Commit**

```bash
npx tsc --noEmit
git add lib/db-path.ts lib/prisma.ts lib/log-capture.ts lib/config.ts lib/backup.ts tests/unit/backup.test.ts
git commit -m "feat(backup): add SQLite snapshot, listing and pruning"
```

(Commit-Message mit Co-Authored-By-Zeile beenden, siehe Global Constraints.)

---

### Task 2: Fehlerbenachrichtigung, Job und Scheduler

**Files:**
- Modify: `lib/notifications.ts` (`notifyAdmins` exportieren)
- Modify: `lib/backup.ts` (Imports und Funktionen am Dateiende ergänzen)
- Modify: `instrumentation.ts`
- Test: `tests/integration/notifications.test.ts` (neuer `describe`-Block)
- Test: `tests/unit/backup-job.test.ts`

**Interfaces:**
- Consumes (Task 1): `createBackup`, `pruneBackups`, `getBackupDir`, `BackupFileInfo`, `config.backup`.
- Produces:
  - `notifyAdmins(settings: FullSettings, subject: string, message: string, path: string): Promise<boolean>` in `lib/notifications.ts` (`true` = mindestens ein Kanal konfiguriert)
  - `notifyBackupFailure(err: unknown, deps?: { loadSettings?: () => Promise<FullSettings | null>; notify?: NotifyAdmins }): Promise<boolean>` (`true` = an mindestens einen Kanal gesendet)
  - `runBackupJob(deps?: { create?: () => BackupFileInfo; prune?: (dir: string, keepDays: number) => number; notify?: (err: unknown) => Promise<unknown> }): Promise<boolean>` (`true` = Backup erfolgreich)
  - `startBackupScheduler(): void`

Die Fehlermeldung geht über dieselben Kanäle wie die täglichen Admin-Benachrichtigungen (Benachrichtigungs-E-Mail **und** Telegram, je nachdem, was konfiguriert ist). Wer nur Telegram eingerichtet hat, erfährt sonst nie, dass Backups fehlschlagen. `buildChannelTasks` fängt Fehler pro Kanal bereits ab und loggt sie.

- [ ] **Step 1: `notifyAdmins` in `lib/notifications.ts` exportieren**

Direkt über `function buildChannelTasks(` einfügen:

```ts
/**
 * Sends one message to every configured admin channel (notify e-mail address,
 * Telegram) — the same channels as the daily overdue/pending notifications.
 * Each channel logs and swallows its own delivery errors. Returns whether at
 * least one channel is configured.
 */
export async function notifyAdmins(
  settings: FullSettings,
  subject: string,
  message: string,
  path: string
): Promise<boolean> {
  const tasks = buildChannelTasks(settings, subject, message, path);
  await Promise.allSettled(tasks);
  return tasks.length > 0;
}
```

- [ ] **Step 2: Failing Tests schreiben**

a) In `tests/integration/notifications.test.ts` den Import um `notifyAdmins` erweitern (`import { notifyAdmins, sendAdminNotifications } from "@/lib/notifications";`) und am Dateiende anfügen:

```ts
describe("notifyAdmins", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
    mockSendMail.mockClear();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends to e-mail and Telegram when both are configured", async () => {
    expect(await notifyAdmins(baseSettings(), "Backup fehlgeschlagen", "disk full", "/settings/logs")).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toBe("Backup fehlgeschlagen");
    expect(mockSendMail.mock.calls[0][0].text).toContain("disk full");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses Telegram alone when no notify e-mail address is set", async () => {
    const settings = { ...baseSettings(), notifyEmailAddress: null };
    expect(await notifyAdmins(settings, "S", "M", "/")).toBe(true);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns false when no channel is configured", async () => {
    const settings = {
      ...baseSettings(),
      notifyEmailAddress: null,
      notifyTelegramBotToken: null,
      notifyTelegramChatId: null,
    };
    expect(await notifyAdmins(settings, "S", "M", "/")).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

b) `tests/unit/backup-job.test.ts`:

```ts
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
    expect(notify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Tests laufen lassen, müssen fehlschlagen**

Run: `npx vitest run tests/integration/notifications.test.ts tests/unit/backup-job.test.ts`
Expected: FAIL (`notifyBackupFailure is not a function` o. ä.). Die `notifyAdmins`-Tests laufen bereits grün, weil Step 1 die Funktion schon angelegt hat.

- [ ] **Step 4: Imports in `lib/backup.ts` erweitern**

Den Importblock am Dateianfang so ergänzen (bestehende Zeilen bleiben, neue kommen dazu):

```ts
import cron from "node-cron";
import type { ApplicationSettings, CompanyInformation } from "@prisma/client";
import { config } from "@/lib/config";
```

Direkt unter `const log = ...` einfügen:

```ts
type FullSettings = ApplicationSettings & { companyInfo: CompanyInformation };
type NotifyAdmins = (
  settings: FullSettings,
  subject: string,
  message: string,
  path: string
) => Promise<boolean>;

const globalForScheduler = globalThis as unknown as {
  backupSchedulerStarted?: boolean;
};
```

- [ ] **Step 5: Job, Benachrichtigung und Scheduler ans Dateiende von `lib/backup.ts` anhängen**

```ts
async function loadSettings(): Promise<FullSettings | null> {
  // Lazy import: see the note at the top on why this module must not pull in
  // lib/prisma at import time.
  const { default: prisma } = await import("@/lib/prisma");
  return prisma.applicationSettings.findFirst({ include: { companyInfo: true } });
}

async function defaultNotify(...args: Parameters<NotifyAdmins>): Promise<boolean> {
  // Lazy for the same reason: lib/notifications pulls in the whole daily
  // notification chain, which the logs page and download route don't need.
  const { notifyAdmins } = await import("@/lib/notifications");
  return notifyAdmins(...args);
}

/**
 * Tells the admins that a backup failed, over the same channels as the daily
 * notifications (notify e-mail address, Telegram). Runs at most once per
 * nightly job, so no extra throttling. Never throws: a broken notification
 * setup must not affect the job. Returns whether a message went out.
 */
export async function notifyBackupFailure(
  err: unknown,
  deps: {
    loadSettings?: () => Promise<FullSettings | null>;
    notify?: NotifyAdmins;
  } = {}
): Promise<boolean> {
  try {
    const settings = await (deps.loadSettings ?? loadSettings)();
    if (!settings) return false;
    const reason = err instanceof Error ? err.message : String(err);
    return await (deps.notify ?? defaultNotify)(
      settings,
      "Backup fehlgeschlagen",
      `Das nächtliche Datenbank-Backup ist fehlgeschlagen:\n\n${reason}\n\nBitte Speicherplatz und Zielverzeichnis prüfen.`,
      "/settings/logs"
    );
  } catch (notifyErr) {
    log.error({ err: notifyErr }, "Could not send backup failure notification");
    return false;
  }
}

/**
 * One nightly run: snapshot, then prune. Pruning only happens after a
 * successful snapshot, and a pruning failure alone does not count as a failed
 * backup. Returns whether the snapshot succeeded.
 */
export async function runBackupJob(
  deps: {
    create?: () => BackupFileInfo;
    prune?: (dir: string, keepDays: number) => number;
    notify?: (err: unknown) => Promise<unknown>;
  } = {}
): Promise<boolean> {
  const create = deps.create ?? (() => createBackup());
  const prune = deps.prune ?? ((dir, keepDays) => pruneBackups(dir, keepDays));
  const notify = deps.notify ?? ((err: unknown) => notifyBackupFailure(err));

  try {
    const info = create();
    log.info({ name: info.name, sizeBytes: info.sizeBytes }, "Backup created");
  } catch (err) {
    log.error({ err }, "Backup failed");
    await notify(err);
    return false;
  }
  try {
    prune(getBackupDir(), config.backup.keepDays);
  } catch (err) {
    log.error({ err }, "Pruning old backups failed");
  }
  return true;
}

/** Starts the nightly backup cron job (BACKUP_CRON_SCHEDULE, server time). */
export function startBackupScheduler(): void {
  if (globalForScheduler.backupSchedulerStarted) return;
  if (process.env.DISABLE_BACKUP === "true") {
    log.info("Backup disabled (DISABLE_BACKUP=true)");
    return;
  }
  const schedule = config.backup.cronSchedule;
  if (!cron.validate(schedule)) {
    log.error({ schedule }, "Invalid BACKUP_CRON_SCHEDULE — backup scheduler not started");
    return;
  }
  cron.schedule(schedule, () => {
    runBackupJob().catch((err) => log.error({ err }, "Backup job crashed"));
  });
  globalForScheduler.backupSchedulerStarted = true;
  log.info(
    { schedule, dir: getBackupDir(), keepDays: config.backup.keepDays },
    "Backup scheduler started"
  );
}
```

- [ ] **Step 6: Scheduler in `instrumentation.ts` starten**

Direkt nach `startLogRotationScheduler();` einfügen:

```ts

    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();
```

- [ ] **Step 7: Tests, Typen und Lint**

```bash
npx vitest run tests/unit/backup.test.ts tests/unit/backup-job.test.ts tests/integration/notifications.test.ts
npx tsc --noEmit
npm run lint
```

Expected: alles grün.

- [ ] **Step 8: Commit**

```bash
git add lib/notifications.ts lib/backup.ts instrumentation.ts tests/unit/backup-job.test.ts tests/integration/notifications.test.ts
git commit -m "feat(backup): nightly backup scheduler with admin failure notification"
```

---

### Task 3: Download-Route `GET /api/backups/[filename]`

**Files:**
- Create: `app/api/backups/[filename]/route.ts`
- Test: `tests/integration/backups-route.test.ts`

**Interfaces:**
- Consumes (Task 1): `resolveBackupFilePath(filename)`.
- Produces: HTTP-Endpunkt `/api/backups/<db-YYYY-MM-DD.db>` (Task 4 verlinkt darauf).

- [ ] **Step 1: Failing Test schreiben**

`tests/integration/backups-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));

import { GET } from "@/app/api/backups/[filename]/route";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

const req = (filename: string) => new NextRequest(`http://localhost/api/backups/${filename}`);
const ctx = (filename: string) => ({ params: Promise.resolve({ filename }) });

let dir: string;
let previousBackupDir: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "customermanagement-backups-route-"));
  writeFileSync(join(dir, "db-2026-09-30.db"), "sqlite bytes");
  previousBackupDir = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
});

afterAll(() => {
  if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = previousBackupDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/backups/[filename]", () => {
  it("rejects an unauthenticated request", async () => {
    currentSession = null;
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin", async () => {
    currentSession = sessionFor("Editor");
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(403);
  });

  it("streams a backup for an admin", async () => {
    currentSession = sessionFor("Admin");
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
    expect(res.headers.get("Content-Disposition")).toContain("db-2026-09-30.db");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("sqlite bytes");
  });

  it("returns 404 for a backup that does not exist", async () => {
    currentSession = sessionFor("Admin");
    const res = await GET(req("db-2020-01-01.db"), ctx("db-2020-01-01.db"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a filename outside the exact backup shape", async () => {
    currentSession = sessionFor("Admin");
    for (const name of ["../../.env", "..%2F..%2F.env", "db-2026-09-30.db.tmp", "customermanagement.db"]) {
      const res = await GET(req(name), ctx(name));
      expect(res.status).toBe(404);
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/integration/backups-route.test.ts`
Expected: FAIL (Route existiert nicht).

- [ ] **Step 3: Route implementieren**

`app/api/backups/[filename]/route.ts`:

```ts
import { NextRequest } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { resolveBackupFilePath } from "@/lib/backup";

/**
 * Streams one nightly database backup for download. Admin-only: a backup is a
 * full copy of the database, including password hashes, TOTP secrets and
 * SMTP credentials — the same sensitivity as app/api/export/database.
 *
 * An API route rather than a Server Action because the response is a file
 * stream, not a mutation (same reasoning as app/api/logs/[filename]).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== UserRole.Admin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { filename } = await params;
  // resolveBackupFilePath only accepts the exact db-YYYY-MM-DD.db shape, so a
  // filename like "../../.env" never resolves to a path outside the backup dir.
  const path = resolveBackupFilePath(filename);
  if (!path || !existsSync(path)) {
    return Response.json({ error: "Datei nicht gefunden." }, { status: 404 });
  }

  const size = statSync(path).size;
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Test laufen lassen, muss bestehen**

Run: `npx vitest run tests/integration/backups-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add "app/api/backups/[filename]/route.ts" tests/integration/backups-route.test.ts
git commit -m "feat(backup): admin-only backup download route"
```

---

### Task 4: Backup-Liste in Einstellungen → Logs

**Files:**
- Modify: `app/(app)/settings/logs/page.tsx`

**Interfaces:**
- Consumes: `listBackups()` (Task 1), Route aus Task 3.
- Produces: nichts (reine UI).

- [ ] **Step 1: Import und Daten ergänzen**

In `app/(app)/settings/logs/page.tsx` unter `import { listLogFiles } from "@/lib/logs";` einfügen:

```tsx
import { listBackups, type BackupFileInfo } from "@/lib/backup";
```

Nach `const files = listLogFiles();` einfügen:

```tsx
  // A BACKUP_DIR that exists but isn't readable (e.g. a mount with the wrong
  // owner) must not take the whole logs page down with it.
  let backups: BackupFileInfo[] = [];
  let backupsUnreadable = false;
  try {
    backups = listBackups();
  } catch {
    backupsUnreadable = true;
  }
```

- [ ] **Step 2: Backup-Abschnitt anfügen**

Direkt vor dem letzten `</div>` der Komponente (nach dem schliessenden `</div>` des `overflow-x-auto`-Blocks der Log-Tabelle) einfügen:

```tsx
      <div className="space-y-2 pt-6">
        <h2 className="text-lg font-semibold">Backups</h2>
        <p className="text-sm text-muted-foreground">
          Jede Nacht wird ein Snapshot der Datenbank gespeichert. Ein Backup enthält alle Daten,
          auch Passwort-Hashes und SMTP-Zugangsdaten — sicher aufbewahren. Für eine Kopie ausser
          Haus das Backup-Verzeichnis (<code>BACKUP_DIR</code>) extern sichern.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Datei</TableHead>
                <TableHead>Grösse</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {backupsUnreadable
                      ? "Backup-Verzeichnis ist nicht lesbar (Berechtigungen von BACKUP_DIR prüfen)."
                      : "Noch kein Backup vorhanden."}
                  </TableCell>
                </TableRow>
              ) : (
                backups.map((backup) => (
                  <TableRow key={backup.name}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateCH(backup.date)}
                    </TableCell>
                    <TableCell className="text-sm">{backup.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatSize(backup.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={`/api/backups/${encodeURIComponent(backup.name)}`} />}
                      >
                        Herunterladen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
```

- [ ] **Step 3: Titel und Beschreibung der Seite anpassen**

Im Kopfbereich `<h1 className="text-2xl font-semibold">Logs</h1>` ersetzen durch:

```tsx
          <h1 className="text-2xl font-semibold">Logs &amp; Backups</h1>
```

Auf der Einstellungsseite `app/(app)/settings/page.tsx` steht der Button-Text `Logs` in einer eigenen Zeile (Zeile ~28, direkt unter `<Button … render={<Link href="/settings/logs" />}>`). Diesen Text durch `Logs &amp; Backups` ersetzen; das `href` bleibt `/settings/logs`.

- [ ] **Step 4: Typen, Lint, Sichtprüfung**

```bash
npx tsc --noEmit
npm run lint
```

Dann `npm run dev`, als Admin `/settings/logs` öffnen: leere Backup-Tabelle mit „Noch kein Backup vorhanden.“. Danach ein Backup erzeugen: den Dev-Server mit `BACKUP_CRON_SCHEDULE="* * * * *" npm run dev` neu starten, eine Minute warten (im Log erscheint `Backup created`) und die Seite neu laden. Alternativ direkt: `npx tsx -e "import('./lib/backup').then(m=>console.log(m.createBackup()))"`. Die Datei erscheint mit Datum und Grösse, „Herunterladen“ liefert eine öffnbare SQLite-Datei. Wenn keine Sichtprüfung im Browser möglich ist, dies im Abschlussbericht ausdrücklich sagen.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/logs/page.tsx" "app/(app)/settings/page.tsx"
git commit -m "feat(backup): list and download backups under settings logs"
```

---

### Task 5: Dokumentation, Handbuch und Feature-Analyse

**Files:**
- Modify: `CLAUDE.md` (Abschnitt „Logs“ und Env-Tabelle)
- Modify: `DEPLOYMENT.md` (Abschnitt „3. Daten & Backup“)
- Modify: `public/benutzerhandbuch.html` (Nav-Eintrag Zeile ~378, Abschnitt `admin-logs` Zeile ~757)
- Modify: `FEATURE_ANALYSE.md` (F4-Eintrag in „Phase 1“)

**Interfaces:** keine.

- [ ] **Step 1: CLAUDE.md ergänzen**

CLAUDE.md ist auf Englisch; der neue Absatz ebenfalls. Nach dem Absatz `**Logs** (...)` einfügen:

```markdown
**Backups** (`lib/backup.ts`): `startBackupScheduler()` (called from `instrumentation.ts`, after `startLogCapture()`) writes a nightly SQLite snapshot to `backups/db-YYYY-MM-DD.db` next to the database file (`VACUUM INTO` a `.tmp` file, then an atomic rename). `pruneBackups` runs only after a successful snapshot, deletes backups older than `BACKUP_KEEP_DAYS` (default 30, `0` = keep all, compared by calendar day) and always keeps the newest one. A failure is logged and sent to the admin notification channels (notify e-mail address and Telegram, via `notifyAdmins` in `lib/notifications.ts`). `lib/backup.ts` loads Prisma and `lib/notifications` only lazily in that failure path, and takes the DB path from the dependency-free `lib/db-path.ts`. Admins download backups under Einstellungen → Logs & Backups (`GET /api/backups/[filename]`, filename validated against the exact `db-YYYY-MM-DD.db` shape). Restore = stop the app, copy the file over `customermanagement.db` and delete any `-wal`/`-shm` next to it, start the app (steps in `DEPLOYMENT.md`). Off-site copies are out of scope for the app (rsync/rclone on `BACKUP_DIR`).
```

In der Env-Tabelle nach der Zeile `LOG_ROTATE_CRON_SCHEDULE / LOG_MAX_KEEP_DAYS` einfügen:

```markdown
| `BACKUP_DIR` / `BACKUP_CRON_SCHEDULE` / `BACKUP_KEEP_DAYS` / `DISABLE_BACKUP` | No | Nightly DB backup: target directory (default `<data>/backups`), schedule in server time (default `15 2 * * *`; the container is UTC unless `TZ` is set), retention in days (default `30`, `0` = keep all), `true` turns the job off |
```

- [ ] **Step 2: DEPLOYMENT.md aktualisieren**

Den Abschnitt `## 3. Daten & Backup` (bis vor `---` / `## 4.`) ersetzen durch:

````markdown
## 3. Daten & Backup

Die App sichert die Datenbank **automatisch jede Nacht um 02:15 Serverzeit** nach `data/backups/db-JJJJ-MM-TT.db` und behält 30 Tage. Die Dateien lassen sich unter *Einstellungen → Logs & Backups* herunterladen.

| Variable | Standard | Bedeutung |
|---|---|---|
| `BACKUP_DIR` | `data/backups` | Zielordner, z. B. ein gemounteter USB-Stick oder NAS |
| `BACKUP_CRON_SCHEDULE` | `15 2 * * *` | Zeitplan (Serverzeit) |
| `BACKUP_KEEP_DAYS` | `30` | Aufbewahrung in Tagen, `0` = alles behalten |
| `DISABLE_BACKUP` | – | `true` schaltet das automatische Backup ab |

**Zeitzone:** Der Container läuft ohne weitere Angabe in UTC, 02:15 ist dann 03:15 (Winter) bzw. 04:15 (Sommer) Schweizer Zeit, und das Datum im Dateinamen ist ein UTC-Datum. Für Schweizer Zeit in der `.env` `TZ=Europe/Zurich` setzen (gilt auch für die Log-Rotation und die täglichen Benachrichtigungen).

Schlägt ein Backup fehl, geht eine Meldung an die Benachrichtigungs-Kanäle aus den Einstellungen (Benachrichtigungs-E-Mail und/oder Telegram).

**Speicherplatz:** Jedes Backup ist eine vollständige Kopie der Datenbank, inklusive Dateianhängen und Logo. 30 Backups brauchen also rund 30-mal die Grösse von `customermanagement.db`. Grösse prüfen (`du -sh data/customermanagement.db data/backups`) und `BACKUP_KEEP_DAYS` bei Bedarf senken.

**Wichtig:** Liegt `data/backups` auf derselben SD-Karte wie die Datenbank, schützt es nicht vor einem Kartendefekt. Deshalb `BACKUP_DIR` auf ein externes Laufwerk legen oder das Verzeichnis regelmässig ausser Haus kopieren, z. B. per Cron:

```bash
# Täglich um 05:00 auf ein NAS spiegeln (nach dem Backup, auch bei UTC im Container)
# 0 5 * * * rsync -a ~/customer-management/data/backups/ nas:/backups/customer-management/
```

Ein Backup enthält alle Daten inklusive Passwort-Hashes und SMTP-Zugang. Nur an vertrauenswürdigen Orten ablegen.

### Wiederherstellen

```bash
cd ~/customer-management
docker compose down
# Kaputte DB beiseitelegen (als Kopie, damit die Originaldatei mit ihren
# Rechten bestehen bleibt und gleich überschrieben werden kann)
cp data/customermanagement.db data/customermanagement.db.defekt
# Alte WAL-Dateien MÜSSEN weg: SQLite würde sie sonst in das
# wiederhergestellte Backup einspielen und es beschädigen
rm -f data/customermanagement.db-wal data/customermanagement.db-shm
cp data/backups/db-2026-09-30.db data/customermanagement.db
docker compose up -d
```

Beim Start spielt die App fehlende Migrationen automatisch ein, ein Backup einer älteren Version lässt sich also direkt verwenden.

### Manuelles Backup

Bei laufender App **nicht** die DB-Datei mit `cp` kopieren: ohne die `-wal`-Datei ist die Kopie unvollständig oder inkonsistent. Stattdessen:

- in der App unter *Einstellungen → Datenbank exportieren* (konsistenter Snapshot, gleiche Technik wie das nächtliche Backup), oder
- mit gestoppter App kopieren:

```bash
docker compose down
cp ~/customer-management/data/customermanagement.db \
   ~/customer-management/data/backup-$(date +%Y%m%d-%H%M).db
docker compose up -d
```
````

- [ ] **Step 3: Benutzerhandbuch ergänzen**

In `public/benutzerhandbuch.html`:

a) Nav-Eintrag (Zeile ~378): `<a href="#admin-logs">Logs<span class="nav-pill admin">Admin</span></a>` ersetzen durch `<a href="#admin-logs">Logs &amp; Backups<span class="nav-pill admin">Admin</span></a>`.

b) Im Abschnitt `id="admin-logs"` die Überschrift `<h2>Logs</h2>` ersetzen durch `<h2>Logs &amp; Backups</h2>`, und den `<p class="dek">` ersetzen durch:

```html
<p class="dek">Technische Server-Logs (identisch mit dem, was <code>docker logs</code> anzeigen würde) zum Herunterladen – hilfreich bei der Fehlersuche. Darunter finden Sie die nächtlichen Datenbank-Backups.</p>
```

c) Den letzten Absatz des Abschnitts (`<p>Die laufende Logdatei wird nachts rotiert; ...</p>`) stehen lassen und danach vor `</section>` einfügen:

```html
      <h3>Automatisches Backup</h3>
      <p>Jede Nacht (standardmässig um 02:15 Serverzeit) speichert die Anwendung eine vollständige Kopie der Datenbank (<code>db-JJJJ-MM-TT.db</code>) und behält standardmässig 30 Tage. Die Liste unter <em>Backups</em> zeigt Datum und Grösse; mit <em>Herunterladen</em> speichern Sie ein Backup auf Ihren Computer.</p>
      <ul>
        <li><strong>Sicher aufbewahren:</strong> Ein Backup enthält alle Kunden-, Rechnungs- und Benutzerdaten inklusive Passwort-Hashes und SMTP-Zugang.</li>
        <li><strong>Kopie ausser Haus:</strong> Liegt das Backup auf demselben Gerät wie die Datenbank (z.&nbsp;B. derselben SD-Karte), schützt es nicht vor einem Geräteausfall. Ihr Administrator sollte das Backup-Verzeichnis regelmässig extern sichern.</li>
        <li><strong>Fehler:</strong> Schlägt ein Backup fehl, erhalten Sie eine Meldung über die in den Einstellungen hinterlegten Benachrichtigungs-Kanäle (E-Mail und/oder Telegram).</li>
        <li><strong>Wiederherstellen:</strong> Erfolgt durch den Administrator auf dem Server (Anleitung in <code>DEPLOYMENT.md</code>); eine Wiederherstellung über die Oberfläche gibt es nicht.</li>
      </ul>
```

Falls `<h3>` und `<ul>` im Handbuch anders gestaltet werden (Klassen), an ein bestehendes Beispiel im selben Dokument anlehnen: `grep -n "<h3" public/benutzerhandbuch.html | head`.

d) Screenshot (optional, nur wenn der Playwright-Aufbau lokal läuft): `npm run manual:screenshots -- settings-logs`, danach `npm run manual:splice`. Die Demo-Daten enthalten keine Backups; die Tabelle zeigt dann „Noch kein Backup vorhanden.“ Wird der Screenshot nicht neu erzeugt, im Abschlussbericht vermerken, dass das Bild noch die alte Seite zeigt.

- [ ] **Step 4: FEATURE_ANALYSE.md aktualisieren**

Die Zeile, die mit `- [ ] 4. F4 Belegarchiv und automatisches Backup` beginnt, per Textsuche finden (nicht per Zeilennummer, die Datei ändert sich laufend) und ersetzen durch:

```markdown
- [ ] 4. F4 Belegarchiv und automatisches Backup (Teil C Backup erledigt; offen: kein PDF-Archiv mit Hash, keine Hash-Kette im Audit-Log)
  - [x] C Automatisches nächtliches Backup (`lib/backup.ts`)
  - [ ] A PDF-Archiv mit SHA-256-Hash
  - [ ] B Hash-Kette im Audit-Log
```

- [ ] **Step 5: Gesamtprüfung**

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: alles grün. Danach kurz `git diff --stat` prüfen: das Handbuch darf nur die genannten Stellen ändern (die base64-Bilder bleiben unberührt).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md DEPLOYMENT.md public/benutzerhandbuch.html FEATURE_ANALYSE.md
# Vorher mit `git diff FEATURE_ANALYSE.md` prüfen, dass nur der F4-Eintrag drin ist;
# fremde, nicht committete Änderungen an der Datei nicht mitcommitten (git add -p).
git commit -m "docs(backup): document nightly backup in deployment guide, manual and CLAUDE.md"
```
