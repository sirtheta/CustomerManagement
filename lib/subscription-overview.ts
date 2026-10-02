import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { toDateString } from "@/lib/date";
import type { SubscriptionIntervalName } from "@/lib/subscription-dates";

export type SubscriptionOverviewRow = {
  id: number;
  customerId: number;
  customerName: string;
  interval: SubscriptionIntervalName;
  nextInvoiceDate: string; // "YYYY-MM-DD"
  autoSend: boolean;
  active: boolean;
  templateId: number | null;
  templateName: string | null;
};

/**
 * One row per subscription of a non-archived customer: active ones by next
 * invoice date, paused ones after them (they create nothing, so their date is
 * not "upcoming"), so a paused subscription stays findable for resuming.
 */
export async function listSubscriptionOverview(prisma: PrismaClient): Promise<SubscriptionOverviewRow[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { customer: { archivedAt: null } },
    include: {
      customer: { select: { customerId: true, company: true, contactPerson: true, contactInsteadOfCompany: true } },
      template: { select: { name: true } },
    },
    orderBy: [{ active: "desc" }, { nextInvoiceDate: "asc" }, { id: "asc" }],
  });

  return subscriptions.map((s) => ({
    id: s.id,
    customerId: s.customer.customerId,
    customerName: customerDisplayName(s.customer),
    interval: s.interval,
    nextInvoiceDate: toDateString(s.nextInvoiceDate),
    autoSend: s.autoSend,
    active: s.active,
    templateId: s.templateId,
    templateName: s.template?.name ?? null,
  }));
}
