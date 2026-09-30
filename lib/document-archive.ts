import { createHash } from "crypto";
import { chmod, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

/**
 * Archive of the exact PDFs that were attached to sent invoices and reminders.
 * Deliberately free of any Prisma import: the DB record (`SentDocument`) is
 * written by the caller, so this module stays testable with a temp directory.
 */

export type ArchiveKind = "Invoice" | "Reminder";

export interface ArchiveResult {
  /** Relative to `archiveRootDir()`, always with forward slashes. */
  path: string;
  sha256: string;
  size: number;
}

/** Archive root: `ARCHIVE_DIR`, else an `archive` folder next to the SQLite file (inside the data volume). */
export function archiveRootDir(): string {
  if (process.env.ARCHIVE_DIR) return resolve(process.env.ARCHIVE_DIR);
  const dbPath = (process.env.DATABASE_URL ?? "file:./data/customermanagement.db").replace(/^file:/, "");
  return resolve(dirname(dbPath), "archive");
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** `2026-09-30T10:15:00.123Z` → `20260930T101500123Z` */
function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/**
 * Writes the PDF to `<root>/<year>/<number>_<kind>_<timestamp>.pdf`. The path is
 * built from the arguments only, never from user input. `wx` refuses to
 * overwrite, and the file is made read-only afterwards.
 */
export async function archivePdf(input: {
  documentNumber: string;
  kind: ArchiveKind;
  pdf: Uint8Array;
  now?: Date;
}): Promise<ArchiveResult> {
  const now = input.now ?? new Date();
  const relPath = `${now.getFullYear()}/${safeSegment(input.documentNumber)}_${input.kind}_${timestamp(now)}.pdf`;
  const absPath = join(archiveRootDir(), relPath);

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.pdf, { flag: "wx" });
  await chmod(absPath, 0o444);

  return { path: relPath, sha256: sha256Hex(input.pdf), size: input.pdf.byteLength };
}

/** Resolves a stored relative path against the archive root; `null` if it would leave the root. */
export function resolveArchivePath(relPath: string): string | null {
  // Stored paths always use forward slashes. Backslashes and drive letters are
  // rejected explicitly because on Linux `isAbsolute("C:\\x")` is false and
  // `resolve` would treat the whole string as one file name inside the root.
  if (relPath === "" || isAbsolute(relPath) || /[\\\0]/.test(relPath) || /^[A-Za-z]:/.test(relPath)) {
    return null;
  }
  const root = archiveRootDir();
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return abs;
}

export type VerifyResult =
  | { ok: true; data: Buffer }
  | { ok: false; reason: "missing" | "mismatch" };

/** Reads the archived file and compares size and SHA-256 with the stored record. */
export async function verifyArchived(record: {
  path: string;
  sha256: string;
  size: number;
}): Promise<VerifyResult> {
  const abs = resolveArchivePath(record.path);
  if (!abs) return { ok: false, reason: "missing" };

  let data: Buffer;
  try {
    data = await readFile(abs);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (data.byteLength !== record.size || sha256Hex(data) !== record.sha256) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, data };
}
