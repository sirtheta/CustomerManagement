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
