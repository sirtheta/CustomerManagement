import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  archivePdf,
  archiveRootDir,
  resolveArchivePath,
  sha256Hex,
  verifyArchived,
} from "@/lib/document-archive";

let dir: string;
const pdf = Buffer.from("%PDF-1.4 test bytes");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archive-test-"));
  process.env.ARCHIVE_DIR = dir;
});

afterEach(() => {
  delete process.env.ARCHIVE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("archiveRootDir", () => {
  it("uses ARCHIVE_DIR when set", () => {
    expect(archiveRootDir()).toBe(dir);
  });

  it("defaults to an archive folder next to the database file", () => {
    delete process.env.ARCHIVE_DIR;
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "file:./somewhere/app.db";
    try {
      expect(archiveRootDir().replace(/\\/g, "/")).toMatch(/\/somewhere\/archive$/);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});

describe("archivePdf", () => {
  const now = new Date(2026, 8, 30, 10, 15, 0, 123); // local time, September 2026

  it("writes the file and returns path, hash and size", async () => {
    const result = await archivePdf({ documentNumber: "I-26090001", kind: "Invoice", pdf, now });
    expect(result.path).toMatch(/^2026\/I-26090001_Invoice_\d{8}T\d{9}Z\.pdf$/);
    expect(result.size).toBe(pdf.byteLength);
    expect(result.sha256).toBe(sha256Hex(pdf));
    expect(readFileSync(join(dir, result.path))).toEqual(pdf);
  });

  it("makes the file read-only", async () => {
    const result = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now });
    expect(statSync(join(dir, result.path)).mode & 0o200).toBe(0);
  });

  it("normalises unsafe characters in the document number", async () => {
    const result = await archivePdf({ documentNumber: "../../etc/pass wd", kind: "Reminder", pdf, now });
    expect(result.path.startsWith("2026/")).toBe(true);
    expect(result.path).not.toContain("..");
    expect(result.path.split("/")).toHaveLength(2);
    expect(result.path).toContain("_Reminder_");
  });

  it("never overwrites an existing file", async () => {
    const fixed = new Date(2026, 8, 30, 10, 15, 0, 123);
    const first = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now: fixed });
    await expect(
      archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf: Buffer.from("other"), now: fixed })
    ).rejects.toThrow();
    expect(readFileSync(join(dir, first.path))).toEqual(pdf);
  });

  it("creates a distinct file for a second send", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now });
    const b = await archivePdf({
      documentNumber: "I-1",
      kind: "Invoice",
      pdf,
      now: new Date(now.getTime() + 5),
    });
    expect(a.path).not.toBe(b.path);
  });
});

describe("resolveArchivePath", () => {
  it("resolves a relative path inside the root", () => {
    expect(resolveArchivePath("2026/a.pdf")).toBe(join(dir, "2026", "a.pdf"));
  });

  it.each(["../x.pdf", "2026/../../x.pdf", "/etc/passwd", "C:\\Windows\\x.pdf", "", "."])(
    "rejects %s",
    (p) => {
      expect(resolveArchivePath(p)).toBeNull();
    }
  );
});

describe("verifyArchived", () => {
  it("returns the bytes when hash and size match", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    const result = await verifyArchived(a);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(pdf);
  });

  it("reports a missing file", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    rmSync(join(dir, a.path));
    expect(await verifyArchived(a)).toEqual({ ok: false, reason: "missing" });
  });

  it("reports a path outside the root as missing", async () => {
    expect(await verifyArchived({ path: "../x.pdf", sha256: "a".repeat(64), size: 1 })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a manipulated file", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    const abs = join(dir, a.path);
    chmodSync(abs, 0o644);
    writeFileSync(abs, "%PDF-1.4 tampered bytes");
    expect(await verifyArchived(a)).toEqual({ ok: false, reason: "mismatch" });
  });
});
