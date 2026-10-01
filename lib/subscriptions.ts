import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { calculateInvoiceTotal, calculateItemTotal } from "@/lib/calculations";
import { advancePast, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import { logAuditEntry } from "@/lib/audit";
import { formatCurrency, formatDate } from "@/lib/utils";
import logger from "@/lib/logger";

const log = logger.child({ module: "subscriptions" });

const DEFAULT_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
const DEFAULT_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date} über {totalAmount}.\n\nZahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}";

/** Actor for documents the job sends on its own (autoSend); audit and archive rows need a user id. */
export const SYSTEM_ACTOR: Session = {
  user: { id: "0", name: "System (Abo)", email: "", role: "Admin" },
  expires: "9999-12-31T23:59:59.999Z",
} as Session;

class SubscriptionChangedError extends Error {
  constructor() {
    super("Abo wurde seit dem Laden verändert oder pausiert.");
  }
}

type JobSettings = NonNullable<Awaited<ReturnType<PrismaClient["applicationSettings"]["findFirst"]>>>;

/** Logs and tells the admins (notify e-mail / Telegram); draft and PendingEmail stay for manual approval. */
async function reportAutoSendFailure(
  settings: (JobSettings & { companyInfo: unknown }) | null,
  subscriptionId: number,
  invoiceId: number,
  error: string
): Promise<void> {
  log.error({ subscriptionId, invoiceId, error }, "Auto-send failed, invoice waits for manual approval");
  if (!settings) return;
  try {
    const { notifyAdmins } = await import("@/lib/notifications");
    await notifyAdmins(
      settings as Parameters<typeof notifyAdmins>[0],
      "Abo-Rechnung konnte nicht versendet werden",
      `Die Abo-Rechnung (Entwurf ${invoiceId}) konnte nicht automatisch versendet werden: ${error}. Sie wartet auf die manuelle Freigabe.`,
      "/invoices/pending"
    );
  } catch (err) {
    log.error({ err, subscriptionId }, "Notifying the admins about the failed auto-send failed");
  }
}

function resolve(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export async function checkSubscriptions(prisma: PrismaClient): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [settings, due] = await Promise.all([
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
    prisma.subscription.findMany({
      where: { active: true, nextInvoiceDate: { lte: today }, customer: { archivedAt: null } },
      include: {
        customer: true,
        template: { include: { items: { orderBy: { id: "asc" } } } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  if (due.length === 0) return;

  const companyName = settings?.companyInfo.companyName ?? "";
  const subjectTpl = settings?.emailSubjectTemplate || DEFAULT_SUBJECT;
  const bodyTpl = settings?.emailBodyTemplate || DEFAULT_BODY;
  const paymentDays = settings?.defaultPaymentTermDays ?? 30;

  for (const sub of due) {
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const items = (sub.template?.items ?? []).map((item) => {
      const quantity = item.quantity.toNumber();
      const unitPrice = item.unitPrice.toNumber();
      return {
        name: item.name,
        description: item.description,
        unit: item.unit,
        unitPrice,
        quantity,
        discountPercent: 0,
        totalAmount: calculateItemTotal({ quantity, unitPrice }),
        categoryId: item.categoryId,
      };
    });
    const totalAmount = calculateInvoiceTotal(items, 0);

    try {
      // Invoice, PendingEmail and the date advance succeed or fail together: a
      // crash between separate awaits would bill the same period twice.
      const { invoiceId, pending } = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            customerId: sub.customerId,
            date: today,
            dueDate,
            totalAmount,
            discountPercent: 0,
            state: "Draft",
            items: { create: items },
          },
        });

        const vars = {
          // Kept as placeholder: the number is only assigned when the mail is approved.
          documentNumber: "{documentNumber}",
          contactPerson: sub.customer.contactPerson,
          companyName,
          totalAmount: formatCurrency(totalAmount),
          date: formatDate(today),
          dueDate: formatDate(dueDate),
          customUserText: "",
        };

        const pendingEmail = await tx.pendingEmail.create({
          data: {
            invoiceId: invoice.id,
            to: sub.customer.email,
            subject: resolve(subjectTpl, vars),
            body: resolve(bodyTpl, vars),
          },
        });

        // Guarded against a pause/edit or an overlapping second run since the due
        // list was read: no match rolls the whole transaction back.
        const advanced = await tx.subscription.updateMany({
          where: { id: sub.id, active: true, nextInvoiceDate: sub.nextInvoiceDate },
          data: {
            nextInvoiceDate: advancePast(sub.nextInvoiceDate, sub.interval as SubscriptionIntervalName, today),
          },
        });
        if (advanced.count === 0) throw new SubscriptionChangedError();

        return { invoiceId: invoice.id, pending: pendingEmail };
      });

      await logAuditEntry(
        {
          userId: parseInt(SYSTEM_ACTOR.user.id, 10),
          userName: SYSTEM_ACTOR.user.name ?? "System (Abo)",
          action: "CREATE",
          entityType: "Invoice",
          entityId: invoiceId,
          entityRef: null,
          details: JSON.stringify({ subscriptionId: sub.id, source: "subscription" }),
        },
        prisma
      );

      // Only a template with items is sent unattended, never a CHF 0 invoice.
      if (sub.autoSend && items.length > 0) {
        try {
          // Loaded lazily: the PDF/mail stack is only needed when something is actually sent.
          const { sendPendingInvoice } = await import("@/lib/pending-email-send");
          const result = await sendPendingInvoice({
            pendingId: pending.id,
            to: pending.to,
            subject: pending.subject,
            body: pending.body,
            actor: SYSTEM_ACTOR,
          });
          if ("error" in result) await reportAutoSendFailure(settings, sub.id, invoiceId, result.error);
        } catch (err) {
          await reportAutoSendFailure(settings, sub.id, invoiceId, err instanceof Error ? err.message : "Unbekannter Fehler");
        }
      }
    } catch (err) {
      // One broken subscription must not block the others; it is retried on the next run.
      if (err instanceof SubscriptionChangedError) {
        log.warn({ subscriptionId: sub.id }, "Subscription changed while the job ran, skipped");
      } else {
        log.error({ err, subscriptionId: sub.id }, "Creating the subscription invoice failed");
      }
    }
  }
}
