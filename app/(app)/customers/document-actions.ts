"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { matchesMagicBytes } from "@/lib/file-validation";
import { logAudit } from "@/lib/audit";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES: Record<string, string> = {
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

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot).toLowerCase();
}

export async function uploadDocument(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Keine Datei ausgewählt" };

  if (file.size > MAX_FILE_SIZE)
    return { error: `Datei zu gross (max. 5 MB): ${file.name}` };

  const ext = getExtension(file.name);
  if (!ALLOWED_TYPES[ext])
    return { error: `Dateityp nicht erlaubt: ${ext || file.name}` };

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!matchesMagicBytes(ext, bytes))
    return { error: `Dateiinhalt entspricht nicht dem Dateityp ${ext}` };

  const document = await prisma.document.create({
    data: {
      customerId,
      name: file.name,
      fileType: ext,
      uploadDate: new Date(),
      content: bytes,
      note: "",
    },
    select: { documentId: true },
  });
  await logAudit(session, "CREATE", "CustomerDocument", document.documentId, file.name, { customerId });

  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function deleteDocument(
  customerId: number,
  documentId: number
): Promise<void> {
  const session = await requireAdmin();
  const document = await prisma.document.delete({ where: { documentId }, select: { name: true } });
  await logAudit(session, "DELETE", "CustomerDocument", documentId, document.name, { customerId });
  revalidatePath(`/customers/${customerId}`);
}

export async function updateDocumentNote(
  customerId: number,
  documentId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const note = (formData.get("note") as string) ?? "";
  const document = await prisma.document.update({
    where: { documentId },
    data: { note },
    select: { name: true },
  });
  // The note text itself stays out of the audit log
  await logAudit(session, "UPDATE", "CustomerDocument", documentId, document.name, { customerId, note: "geändert" });
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}
