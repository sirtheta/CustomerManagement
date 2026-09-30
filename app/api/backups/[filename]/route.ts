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
