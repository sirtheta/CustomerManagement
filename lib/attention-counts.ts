import { InvoiceState, type PrismaClient } from "@prisma/client";
import type { ModuleFlags } from "@/lib/modules";
import type { NavBadgeCounts } from "@/lib/navigation";
import { MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";
import { lastLevelSentReminderIds } from "@/lib/reminders";

type Db = Pick<PrismaClient, "pendingEmail" | "pendingReminder" | "invoice" | "sentDocument">;

/** Reminders that show up in the reminder list right now (not snoozed into the future). */
export function dueReminderWhere(now: Date) {
  return { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
}

/**
 * What the navigation badges and the dashboard/invoice banners count. Both
 * work lists are editor-only, so a Viewer (or a switched-off module) gets 0
 * and never sees a count for a page they cannot use.
 */
export async function loadWorkCounts(
  db: Db,
  modules: ModuleFlags,
  canEdit: boolean,
  now = new Date()
): Promise<NavBadgeCounts> {
  const [pendingEmails, dueReminders] = await Promise.all([
    canEdit && modules.subscriptions ? db.pendingEmail.count() : 0,
    canEdit && modules.reminders ? countSendableReminders(db, now) : 0,
  ]);
  return { pendingEmails, dueReminders };
}

/**
 * Reminders in the list that can still be sent: not snoozed and not past the
 * last level. Cards with "Letzte Stufe erreicht" stay in the list but do not
 * wait for anything the app could send, so they are not counted.
 */
async function countSendableReminders(db: Db, now: Date): Promise<number> {
  const where = dueReminderWhere(now);
  const [total, atLastLevel] = await Promise.all([
    db.pendingReminder.count({ where }),
    db.pendingReminder.findMany({
      where: { AND: [where, { reminderLevel: { gte: MAX_REMINDER_LEVEL } }] },
      select: { id: true, invoiceId: true, reminderLevel: true, createdAt: true },
    }),
  ]);
  if (atLastLevel.length === 0) return total;
  return total - (await lastLevelSentReminderIds(db, atLastLevel)).size;
}

export type AttentionCounts = NavBadgeCounts & {
  /** Invoices in state Overdue; only loaded when the reminder list is not available. */
  overdueInvoices: number;
};

/**
 * Counts for the banners. With the reminder list available the overdue banner
 * points there (and counts its entries), otherwise it counts overdue invoices
 * and points to the filtered invoice list.
 */
export async function loadAttentionCounts(
  db: Db,
  modules: ModuleFlags,
  canEdit: boolean,
  now = new Date()
): Promise<AttentionCounts> {
  const remindersAvailable = canEdit && modules.reminders;
  const [work, overdueInvoices] = await Promise.all([
    loadWorkCounts(db, modules, canEdit, now),
    remindersAvailable ? 0 : db.invoice.count({ where: { state: InvoiceState.Overdue } }),
  ]);
  return { ...work, overdueInvoices };
}

export type AttentionBanner = {
  key: "reminders" | "overdue" | "pendingEmails";
  tone: "danger" | "warning";
  text: string;
  href: string;
  action: string;
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/**
 * One banner per topic, each with one statement and one target, only when
 * its count is above 0. Shared by the dashboard and the invoice list so both
 * say the same thing.
 */
export function attentionBanners(
  counts: AttentionCounts,
  modules: ModuleFlags,
  canEdit: boolean
): AttentionBanner[] {
  const banners: AttentionBanner[] = [];
  if (canEdit && modules.reminders) {
    if (counts.dueReminders > 0) {
      banners.push({
        key: "reminders",
        tone: "danger",
        text: plural(
          counts.dueReminders,
          "1 überfällige Rechnung wartet auf eine Mahnung.",
          "überfällige Rechnungen warten auf eine Mahnung."
        ),
        href: "/invoices/reminders",
        action: "Zu den Mahnungen",
      });
    }
  } else if (counts.overdueInvoices > 0) {
    banners.push({
      key: "overdue",
      tone: "danger",
      text: plural(counts.overdueInvoices, "1 Rechnung ist überfällig.", "Rechnungen sind überfällig."),
      href: "/invoices?state=Overdue",
      action: "Anzeigen",
    });
  }
  if (canEdit && modules.subscriptions && counts.pendingEmails > 0) {
    banners.push({
      key: "pendingEmails",
      tone: "warning",
      text: plural(
        counts.pendingEmails,
        "1 Abo-Rechnung wartet auf Freigabe und Versand.",
        "Abo-Rechnungen warten auf Freigabe und Versand."
      ),
      href: "/invoices/pending",
      action: "Jetzt prüfen",
    });
  }
  return banners;
}
