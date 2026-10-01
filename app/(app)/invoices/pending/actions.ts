"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import type { ActionState } from "@/hooks/use-action-toast";
import { logAudit } from "@/lib/audit";
import { sendPendingInvoice } from "@/lib/pending-email-send";

export async function approvePendingEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const id = parseInt(formData.get("id") as string, 10);
  const to = (formData.get("to") as string).trim();
  const subject = (formData.get("subject") as string).trim();
  const body = (formData.get("body") as string).trim();

  const result = await sendPendingInvoice({ pendingId: id, to, subject, body, actor: session });
  if ("error" in result) return { error: result.error };

  revalidatePath("/invoices/pending");
  revalidatePath(`/invoices/${result.invoiceId}`);
  return { success: true, _ts: Date.now() };
}

export async function discardPendingEmail(id: number): Promise<void> {
  const session = await requireEditor();
  const discarded = await prisma.pendingEmail.delete({
    where: { id },
    include: { invoice: { select: { id: true, documentNumber: true } } },
  });
  await logAudit(session, "DELETE", "Invoice", discarded.invoice.id, discarded.invoice.documentNumber ?? undefined, {
    reason: "Pending-E-Mail verworfen",
  });
  revalidatePath("/invoices/pending");
}
