"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { INTERVAL_LABELS, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import { isValidDateString, parseDate } from "@/lib/date";
import { requireModule } from "@/lib/module-guard";

type SubscriptionFields = {
  interval: SubscriptionIntervalName;
  nextInvoiceDate: Date;
  templateId: number | null;
  autoSend: boolean;
};

async function parseSubscriptionForm(
  formData: FormData
): Promise<{ error: string } | { data: SubscriptionFields }> {
  const interval = formData.get("interval") as string;
  if (!Object.hasOwn(INTERVAL_LABELS, interval)) return { error: "Ungültiges Intervall." };

  // Local-time parsing (lib/date.ts): `new Date("YYYY-MM-DD")` would be UTC midnight and
  // shift the day around DST changes and for the job's local-midnight comparison.
  const dateRaw = (formData.get("nextInvoiceDate") as string) || "";
  const nextInvoiceDate = isValidDateString(dateRaw) ? parseDate(dateRaw) : undefined;
  if (!nextInvoiceDate) return { error: "Bitte ein gültiges Datum angeben." };

  const templateRaw = (formData.get("templateId") as string) || "";
  const templateId = templateRaw ? parseInt(templateRaw, 10) : null;
  if (templateRaw && Number.isNaN(templateId)) return { error: "Vorlage nicht gefunden." };

  const autoSend = formData.get("autoSend") === "on";
  if (autoSend && templateId == null) return { error: "Automatischer Versand braucht eine Vorlage." };

  if (templateId != null) {
    const template = await prisma.invoiceTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!template) return { error: "Vorlage nicht gefunden." };
    if (autoSend && template._count.items === 0) {
      return {
        error:
          "Die Vorlage hat keine Positionen. Automatischer Versand ist nur mit einer befüllten Vorlage möglich.",
      };
    }
  }

  return { data: { interval: interval as SubscriptionIntervalName, nextInvoiceDate, templateId, autoSend } };
}

export async function createSubscription(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("subscriptions");
  const parsed = await parseSubscriptionForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const subscription = await prisma.subscription.create({
    data: { customerId, ...parsed.data, active: true },
  });
  await logAudit(session, "CREATE", "Subscription", subscription.id, INTERVAL_LABELS[parsed.data.interval], {
    customerId,
    templateId: parsed.data.templateId,
    autoSend: parsed.data.autoSend,
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
  return { success: true, _ts: Date.now() };
}

export async function updateSubscription(
  customerId: number,
  subscriptionId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("subscriptions");
  const parsed = await parseSubscriptionForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  // The form re-sends the date it was rendered with. If it is unchanged, leave the DB value
  // alone: the job may have advanced it meanwhile and writing the stale date would bill twice.
  const loaded = formData.get("loadedNextInvoiceDate");
  const submitted = formData.get("nextInvoiceDate");
  const { nextInvoiceDate: _unchanged, ...withoutDate } = parsed.data;
  void _unchanged;
  const data = typeof loaded === "string" && loaded !== "" && loaded === submitted ? withoutDate : parsed.data;

  const { count } = await prisma.subscription.updateMany({
    where: { id: subscriptionId, customerId },
    data,
  });
  if (count === 0) return { error: "Abo nicht gefunden." };
  await logAudit(session, "UPDATE", "Subscription", subscriptionId, INTERVAL_LABELS[parsed.data.interval], {
    customerId,
    templateId: parsed.data.templateId,
    autoSend: parsed.data.autoSend,
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
  return { success: true, _ts: Date.now() };
}

export async function setSubscriptionActive(
  customerId: number,
  subscriptionId: number,
  active: boolean
): Promise<void> {
  const session = await requireEditor();
  await requireModule("subscriptions");
  const { count } = await prisma.subscription.updateMany({ where: { id: subscriptionId, customerId }, data: { active } });
  if (count === 0) return;
  await logAudit(session, "UPDATE", "Subscription", subscriptionId, undefined, { customerId, active });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
}

export async function deleteSubscription(customerId: number, subscriptionId: number): Promise<void> {
  const session = await requireEditor();
  await requireModule("subscriptions");
  const { count } = await prisma.subscription.deleteMany({ where: { id: subscriptionId, customerId } });
  if (count === 0) return;
  await logAudit(session, "DELETE", "Subscription", subscriptionId, undefined, { customerId });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
}
