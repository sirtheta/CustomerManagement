"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireAdmin, requireEditor } from "@/lib/permissions";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50_000;

function validateNoteFields(title: string, content: string): string | null {
  if (!title) return "Titel ist erforderlich";
  if (title.length > MAX_TITLE_LENGTH) return `Titel zu lang (max. ${MAX_TITLE_LENGTH} Zeichen)`;
  if (content.length > MAX_CONTENT_LENGTH) return `Notiz zu lang (max. ${MAX_CONTENT_LENGTH} Zeichen)`;
  return null;
}

export async function createNote(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const title = (formData.get("title") as string)?.trim();
  const content = (formData.get("content") as string) ?? "";
  const validationError = validateNoteFields(title, content);
  if (validationError) return { error: validationError };

  const note = await prisma.customerNote.create({
    data: { customerId, title, content: encryptSecret(content) },
  });

  await logAudit(session, "CREATE", "CustomerNote", note.noteId, title);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function updateNote(
  customerId: number,
  noteId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const title = (formData.get("title") as string)?.trim();
  const content = (formData.get("content") as string) ?? "";
  const validationError = validateNoteFields(title, content);
  if (validationError) return { error: validationError };

  await prisma.customerNote.update({
    where: { noteId },
    data: { title, content: encryptSecret(content) },
  });

  await logAudit(session, "UPDATE", "CustomerNote", noteId, title);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function deleteNote(
  customerId: number,
  noteId: number
): Promise<void> {
  const session = await requireAdmin();
  const note = await prisma.customerNote.delete({ where: { noteId } });
  await logAudit(session, "DELETE", "CustomerNote", noteId, note.title);
  revalidatePath(`/customers/${customerId}`);
}
