"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { isValidDateString, parseDate } from "@/lib/date";
import { requireModule } from "@/lib/module-guard";

const MAX_TITLE_LENGTH = 200;

function revalidate(customerId: number) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
}

export async function createTask(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("tasks");
  const title = ((formData.get("title") as string) ?? "").trim();
  if (!title) return { error: "Titel ist erforderlich" };
  if (title.length > MAX_TITLE_LENGTH) return { error: `Titel zu lang (max. ${MAX_TITLE_LENGTH} Zeichen)` };

  const dueRaw = (formData.get("dueDate") as string) || "";
  const dueDate = isValidDateString(dueRaw) ? parseDate(dueRaw) : undefined;
  if (!dueDate) return { error: "Bitte eine gültige Fälligkeit angeben." };

  const assigneeRaw = (formData.get("assigneeId") as string) || "";
  let assigneeId: number | null = null;
  if (assigneeRaw) {
    assigneeId = parseInt(assigneeRaw, 10);
    const user = Number.isNaN(assigneeId)
      ? null
      : await prisma.user.findFirst({ where: { id: assigneeId, isActive: true }, select: { id: true } });
    if (!user) return { error: "Benutzer nicht gefunden." };
  }

  const customer = await prisma.customer.findUnique({ where: { customerId }, select: { customerId: true } });
  if (!customer) return { error: "Kunde nicht gefunden." };

  const task = await prisma.task.create({ data: { customerId, title, dueDate, assigneeId } });
  await logAudit(session, "CREATE", "Task", task.id, title, { customerId });
  revalidate(customerId);
  return { success: true, _ts: Date.now() };
}

export async function setTaskDone(customerId: number, taskId: number, done: boolean): Promise<void> {
  const session = await requireEditor();
  await requireModule("tasks");
  const { count } = await prisma.task.updateMany({
    where: { id: taskId, customerId },
    data: { doneAt: done ? new Date() : null, notifiedAt: null },
  });
  if (count === 0) return;
  await logAudit(session, "UPDATE", "Task", taskId, undefined, { customerId, done });
  revalidate(customerId);
}

export async function deleteTask(customerId: number, taskId: number): Promise<void> {
  const session = await requireEditor();
  await requireModule("tasks");
  const task = await prisma.task.findFirst({ where: { id: taskId, customerId }, select: { title: true } });
  if (!task) return;
  await prisma.task.delete({ where: { id: taskId } });
  await logAudit(session, "DELETE", "Task", taskId, task.title, { customerId });
  revalidate(customerId);
}
