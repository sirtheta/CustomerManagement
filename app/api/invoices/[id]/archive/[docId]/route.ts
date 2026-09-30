import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/permissions";
import { verifyArchived } from "@/lib/document-archive";
import { UserRole } from "@prisma/client";
import { NextRequest } from "next/server";
import logger from "@/lib/logger";

const log = logger.child({ module: "api.invoice-archive" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, docId } = await params;
  const invoiceId = parseInt(id, 10);
  const sentDocumentId = parseInt(docId, 10);
  if (isNaN(invoiceId) || isNaN(sentDocumentId)) {
    return Response.json({ error: "Bad Request" }, { status: 400 });
  }

  const doc = await prisma.sentDocument.findFirst({
    where: { id: sentDocumentId, invoiceId },
  });
  if (!doc) return Response.json({ error: "Not Found" }, { status: 404 });

  const result = await verifyArchived(doc);
  if (!result.ok) {
    log.error({ sentDocumentId, invoiceId, reason: result.reason }, "Archived PDF failed verification");
    return Response.json(
      {
        error:
          result.reason === "missing"
            ? "Die Archivdatei fehlt."
            : "Die Archivdatei stimmt nicht mehr mit der gespeicherten Prüfsumme überein.",
      },
      { status: 409 }
    );
  }

  const date = doc.createdAt.toLocaleDateString("sv-SE"); // YYYY-MM-DD in server time
  const safeNumber = doc.documentNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeNumber}_${doc.kind}_${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
