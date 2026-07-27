import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";

const MIME_TYPES: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".bmp":  "image/bmp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt":  "text/plain",
  ".md":   "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip":  "application/zip",
  ".rar":  "application/x-rar-compressed",
  ".7z":   "application/x-7z-compressed",
};

const ALL_ROLES = [UserRole.Admin, UserRole.Editor, UserRole.Viewer];

// Formats the browser may render inline without executing active content
// (served with their fixed MIME type + global nosniff). Everything else is
// forced to download.
const INLINE_SAFE = new Set([".pdf", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".txt", ".md"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole(ALL_ROLES);

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId))
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });

  const doc = await prisma.document.findUnique({ where: { documentId } });
  if (!doc) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const mime = MIME_TYPES[doc.fileType] ?? "application/octet-stream";
  const encodedName = encodeURIComponent(doc.name);
  const disposition = INLINE_SAFE.has(doc.fileType) ? "inline" : "attachment";

  return new NextResponse(doc.content, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-cache",
    },
  });
}
