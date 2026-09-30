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
      const { invoiceId } = await prisma.$transaction(async (tx) => {
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

        await tx.pendingEmail.create({
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

        return { invoiceId: invoice.id };
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
