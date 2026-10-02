import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/system-actor";
import { calculateInvoiceTotal, calculateItemTotal } from "@/lib/calculations";
import { advancePast, skippedPeriods, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import { logAuditEntry } from "@/lib/audit";
import { fillPlaceholders, invoiceMailTemplate, invoicePlaceholders } from "@/lib/mail-templates";
import logger from "@/lib/logger";
import { billingEmail, effectivePaymentTermDays } from "@/lib/customer-billing";
import { customerDisplayName } from "@/lib/customer-display";
import { formatDate } from "@/lib/utils";

const log = logger.child({ module: "subscriptions" });

class SubscriptionChangedError extends Error {
  constructor() {
    super("Abo wurde seit dem Laden verändert oder pausiert.");
  }
}

type JobSettings = NonNullable<Awaited<ReturnType<PrismaClient["applicationSettings"]["findFirst"]>>>;

type AutoSendFailure = {
  subscriptionId: number;
  invoiceId: number;
  customerName: string;
  error: string;
  /** The mail is already out; only recording the send failed. Approving again would mail it twice. */
  mailSent: boolean;
};

/**
 * Logs and tells the admins (notify e-mail / Telegram). The invoice is named by
 * its number (the draft may not have one yet) and customer, never by database id.
 */
async function reportAutoSendFailure(
  prisma: PrismaClient,
  settings: (JobSettings & { companyInfo: unknown }) | null,
  failure: AutoSendFailure
): Promise<void> {
  const { subscriptionId, invoiceId, customerName, error, mailSent } = failure;
  log.error({ subscriptionId, invoiceId, error, mailSent }, "Auto-send failed");
  if (!settings) return;
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { documentNumber: true } });
    const label = invoice?.documentNumber ? `Nr. ${invoice.documentNumber}` : "(Entwurf, noch ohne Nummer)";
    const { notifyAdmins } = await import("@/lib/notifications");
    await notifyAdmins(
      settings as Parameters<typeof notifyAdmins>[0],
      mailSent ? "Abo-Rechnung versendet, aber nicht verbucht" : "Abo-Rechnung konnte nicht versendet werden",
      mailSent
        ? `Die Abo-Rechnung ${label} für ${customerName} wurde bereits per E-Mail versendet, konnte aber nicht verbucht werden. Bitte NICHT erneut freigeben, sonst geht die Rechnung ein zweites Mal raus. Entwurf prüfen und die Rechnung manuell als versendet markieren.`
        : `Die Abo-Rechnung ${label} für ${customerName} konnte nicht automatisch versendet werden: ${error}${/[.!?]$/.test(error) ? "" : "."} Sie wartet unter «Offene E-Mails» auf die manuelle Freigabe.`,
      "/invoices/pending"
    );
  } catch (err) {
    log.error({ err, subscriptionId }, "Notifying the admins about the failed auto-send failed");
  }
}

/**
 * One invoice per run, then the date jumps past today, so further periods that
 * were already due (long downtime, a date set far in the past) get no invoice.
 * Tells the admins so they can bill them by hand if needed.
 */
async function reportSkippedPeriods(
  prisma: PrismaClient,
  settings: (JobSettings & { companyInfo: unknown }) | null,
  info: { subscriptionId: number; customerName: string; skipped: number; nextInvoiceDate: Date }
): Promise<void> {
  const { subscriptionId, customerName, skipped, nextInvoiceDate } = info;
  log.warn({ subscriptionId, skipped }, "Subscription periods skipped");
  if (!settings) return;
  try {
    const { notifyAdmins } = await import("@/lib/notifications");
    await notifyAdmins(
      settings as Parameters<typeof notifyAdmins>[0],
      "Abo: Perioden übersprungen",
      `Beim Abo von ${customerName} waren ${skipped + 1} Perioden fällig. Es wurde eine Rechnung erstellt, für ${skipped} weitere Periode(n) wurde keine erstellt. Die nächste Rechnung ist am ${formatDate(nextInvoiceDate)} fällig. Bei Bedarf die fehlenden Rechnungen manuell erstellen.`,
      "/subscriptions"
    );
  } catch (err) {
    log.error({ err, subscriptionId }, "Notifying the admins about skipped subscription periods failed");
  }
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
  // Subscription drafts carry no custom text.
  const mailTpl = invoiceMailTemplate(settings, { isCreditNote: false, hasCustomText: false });
  const defaultPaymentDays = settings?.defaultPaymentTermDays ?? 30;

  for (const sub of due) {
    const paymentDays = effectivePaymentTermDays(sub.customer, defaultPaymentDays);
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
    const totalAmount = calculateInvoiceTotal(items, 0, { roundTo5Rappen: settings?.roundTotalTo5Rappen ?? false });
    const interval = sub.interval as SubscriptionIntervalName;
    const nextInvoiceDate = advancePast(sub.nextInvoiceDate, interval, today);
    const skipped = skippedPeriods(sub.nextInvoiceDate, interval, today);

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
          // The draft has no number yet, so {documentNumber} stays until the mail is approved.
          ...invoicePlaceholders({ ...invoice, customer: sub.customer }, companyName),
          // Kept as placeholder too: positions can be edited on the pending page; resolved at send time.
          totalAmount: undefined,
        };

        const pendingEmail = await tx.pendingEmail.create({
          data: {
            invoiceId: invoice.id,
            to: billingEmail(sub.customer),
            subject: fillPlaceholders(mailTpl.subject, vars),
            body: fillPlaceholders(mailTpl.body, vars),
          },
        });

        // Guarded against a pause/edit or an overlapping second run since the due
        // list was read: no match rolls the whole transaction back.
        const advanced = await tx.subscription.updateMany({
          where: { id: sub.id, active: true, nextInvoiceDate: sub.nextInvoiceDate },
          data: { nextInvoiceDate },
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
          details: JSON.stringify({
            subscriptionId: sub.id,
            source: "subscription",
            ...(skipped > 0 ? { skippedPeriods: skipped } : {}),
          }),
        },
        prisma
      );

      if (skipped > 0) {
        await reportSkippedPeriods(prisma, settings, {
          subscriptionId: sub.id,
          customerName: customerDisplayName(sub.customer),
          skipped,
          nextInvoiceDate,
        });
      }

      // Only a template with items is sent unattended, never a CHF 0 invoice.
      if (sub.autoSend && items.length > 0) {
        const failureBase = {
          subscriptionId: sub.id,
          invoiceId,
          customerName: customerDisplayName(sub.customer),
        };
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
          if ("error" in result) {
            await reportAutoSendFailure(prisma, settings, { ...failureBase, error: result.error, mailSent: result.mailSent === true });
          }
        } catch (err) {
          await reportAutoSendFailure(prisma, settings, {
            ...failureBase,
            error: err instanceof Error ? err.message : "Unbekannter Fehler",
            mailSent: false,
          });
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
