import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { auth } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { getDbPath } from "@/lib/prisma";

/**
 * Streams a full snapshot of the SQLite database file. Admin-only: the
 * database contains password hashes, TOTP secrets and SMTP credentials,
 * not just business data.
 *
 * Uses `VACUUM INTO` on a read-only connection rather than copying the file
 * directly, so the snapshot is a consistent point-in-time copy even while
 * the app is writing to the live database.
 */
export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== UserRole.Admin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), "db-export-"));
  const snapshotPath = path.join(tmpDir, "export.db");

  try {
    const db = new Database(getDbPath(), { readonly: true });
    try {
      db.prepare("VACUUM INTO ?").run(snapshotPath);
    } finally {
      db.close();
    }

    const snapshot = await readFile(snapshotPath);
    const today = new Date().toISOString().slice(0, 10);

    return new Response(new Uint8Array(snapshot), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Length": String(snapshot.length),
        "Content-Disposition": `attachment; filename="datenbank-${today}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
