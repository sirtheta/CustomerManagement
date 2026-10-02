"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import type { ActionState } from "@/hooks/use-action-toast";
import { logAudit } from "@/lib/audit";
import { sendPendingInvoice } from "@/lib/pending-email-send";
import { requireModule } from "@/lib/module-guard";
import { acquireSendLock, invoiceSendLockKey, SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";
import logger from "@/lib/logger";

const log = logger.child({ module: "pending-actions" });

export async function approvePendingEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("subscriptions");

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

export type DiscardResult = ActionState & {
  /** true when the draft invoice was deleted together with the pending mail. */
  invoiceDeleted?: boolean;
  /** Set when only the pending mail was removed, explains why the invoice stayed. */
  message?: string;
};

// Not exported: a "use server" file may only export async functions.
const DISCARD_INVOICE_KEPT_MESSAGE =
  "Die Rechnung ist kein unnummerierter Entwurf mehr und bleibt bestehen. Nur die wartende E-Mail wurde entfernt.";

type DiscardOutcome =
  | { kind: "notFound" }
  | { kind: "deleted"; invoiceId: number; customerId: number }
  | { kind: "kept"; invoiceId: number; documentNumber: string | null };

/**
 * «Verwerfen» on a waiting subscription invoice: deletes the pending mail and its
 * draft in one transaction, so no orphaned draft stays behind. The subscription
 * date was already advanced when the draft was created, so the period is skipped.
 *
 * Editor task (approval workflow), unlike deleteInvoice which is Admin-only: it only
 * ever deletes an unnumbered Draft without payments, sent documents or credit notes.
 * Anything else (sent manually meanwhile, number assigned by a send whose booking
 * failed) keeps the invoice and removes only the pending mail.
 */
export async function discardPendingEmail(id: number): Promise<DiscardResult> {
  const session = await requireEditor();
  await requireModule("subscriptions");

  const ref = await prisma.pendingEmail.findUnique({ where: { id }, select: { invoiceId: true } });
  if (!ref) return { error: "Eintrag nicht gefunden." };

  // Same lock as the send paths: never delete a draft while its mail is going out.
  const release = acquireSendLock(invoiceSendLockKey(ref.invoiceId));
  if (!release) return { error: SEND_IN_PROGRESS_ERROR };

  let outcome: DiscardOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<DiscardOutcome> => {
      const pending = await tx.pendingEmail.findUnique({
        where: { id },
        include: {
          invoice: {
            select: {
              id: true,
              customerId: true,
              documentNumber: true,
              state: true,
              _count: { select: { payments: true, sentDocuments: true, creditNotes: true } },
            },
          },
        },
      });
      if (!pending) return { kind: "notFound" };

      await tx.pendingEmail.delete({ where: { id } });

      const inv = pending.invoice;
      const deletable =
        inv.state === "Draft" &&
        inv.documentNumber === null &&
        inv._count.payments === 0 &&
        inv._count.sentDocuments === 0 &&
        inv._count.creditNotes === 0;
      if (!deletable) return { kind: "kept", invoiceId: inv.id, documentNumber: inv.documentNumber };

      // Item.invoice is onDelete: SetNull, so the items would stay behind without this.
      await tx.item.deleteMany({ where: { invoiceId: inv.id } });
      await tx.invoice.delete({ where: { id: inv.id } });
      return { kind: "deleted", invoiceId: inv.id, customerId: inv.customerId };
    });
  } catch (err) {
    log.error({ id, err }, "discardPendingEmail failed");
    return { error: "Entwurf konnte nicht verworfen werden." };
  } finally {
    release();
  }

  if (outcome.kind === "notFound") return { error: "Eintrag nicht gefunden." };

  revalidatePath("/invoices/pending");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");

  if (outcome.kind === "kept") {
    await logAudit(session, "DELETE", "PendingEmail", id, outcome.documentNumber ?? undefined, {
      invoiceId: outcome.invoiceId,
      reason: "Wartende Abo-E-Mail verworfen, Rechnung bleibt",
    });
    revalidatePath(`/invoices/${outcome.invoiceId}`);
    return { success: true, invoiceDeleted: false, message: DISCARD_INVOICE_KEPT_MESSAGE };
  }

  await logAudit(session, "DELETE", "Invoice", outcome.invoiceId, undefined, {
    reason: "Abo-Entwurf verworfen",
    subscriptionId: await subscriptionOf(outcome.invoiceId),
    customerId: outcome.customerId,
  });
  revalidatePath(`/customers/${outcome.customerId}`);
  return { success: true, invoiceDeleted: true };
}

// The invoice has no link to its subscription; the job's CREATE audit entry names it.
async function subscriptionOf(invoiceId: number): Promise<number | null> {
  try {
    const created = await prisma.auditLog.findFirst({
      where: { action: "CREATE", entityType: "Invoice", entityId: invoiceId },
      orderBy: { id: "desc" },
      select: { details: true },
    });
    const parsed = created?.details ? (JSON.parse(created.details) as { subscriptionId?: unknown }) : null;
    return typeof parsed?.subscriptionId === "number" ? parsed.subscriptionId : null;
  } catch {
    return null;
  }
}
