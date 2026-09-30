import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { dirname, join } from "path";
import logger from "@/lib/logger";
import { toDateString } from "@/lib/date";
import { getDbPath } from "@/lib/db-path";
import cron from "node-cron";
import type { ApplicationSettings, CompanyInformation } from "@prisma/client";
import { config } from "@/lib/config";

const log = logger.child({ module: "backup" });

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
