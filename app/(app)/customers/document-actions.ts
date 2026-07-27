"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { matchesMagicBytes } from "@/lib/file-validation";

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
  await requireEditor();
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

  await prisma.document.create({
    data: {
      customerId,
      name: file.name,
      fileType: ext,
      uploadDate: new Date(),
      content: bytes,
      note: "",
    },
  });

  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function deleteDocument(
  customerId: number,
  documentId: number
): Promise<void> {
  await requireAdmin();
  await prisma.document.delete({ where: { documentId } });
  revalidatePath(`/customers/${customerId}`);
}

export async function updateDocumentNote(
  customerId: number,
  documentId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireEditor();
  const note = (formData.get("note") as string) ?? "";
  await prisma.document.update({
    where: { documentId },
    data: { note },
  });
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}
