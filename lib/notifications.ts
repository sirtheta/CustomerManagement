import cron from "node-cron";
import type { PrismaClient, ApplicationSettings, CompanyInformation } from "@prisma/client";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { createSettingsTransport, hasSmtpSettings, isEmailDisabled, settingsSender } from "@/lib/smtp";
import { getEnabledModules } from "@/lib/modules";

type FullSettings = ApplicationSettings & { companyInfo: CompanyInformation };

const log = logger.child({ module: "notifications" });

const globalForScheduler = globalThis as unknown as {
  notificationSchedulerStarted?: boolean;
};

export function startNotificationScheduler(): void {
  if (globalForScheduler.notificationSchedulerStarted) return;
  const schedule = config.notifications.cronSchedule;
  if (!cron.validate(schedule)) {
    log.error({ schedule }, "Invalid NOTIFY_CRON_SCHEDULE — scheduler not started");
    return;
  }
  cron.schedule(schedule, async () => {
    log.info("Running daily notification check");
    // The shared client uses the better-sqlite3 driver adapter; a plain
    // `new PrismaClient()` has no datasource URL in this setup and throws.
    // lib/daily-jobs is loaded lazily too, because it imports this module.
    const { default: prisma } = await import("@/lib/prisma");
    const { runDailyJobs } = await import("@/lib/daily-jobs");
    await runDailyJobs(prisma);
  });
  globalForScheduler.notificationSchedulerStarted = true;
  log.info({ schedule }, "Notification scheduler started");
}

export async function sendAdminNotifications(
  prisma: PrismaClient,
  settings: FullSettings | null
): Promise<void> {
  if (!settings) return;
  if (!settings.notifyOverdueEnabled && !settings.notifyPendingEnabled) return;

  const now = new Date();
  const modules = await getEnabledModules(prisma);

  const repeatCutoff = settings.notifyRepeatIntervalDays
    ? new Date(now.getTime() - settings.notifyRepeatIntervalDays * 24 * 60 * 60 * 1000)
    : null;
  const notifiedFilter = repeatCutoff
    ? { OR: [{ adminNotifiedAt: null }, { adminNotifiedAt: { lt: repeatCutoff } }] }
    : { adminNotifiedAt: null };

  const [unnotifiedReminders, unnotifiedPending] = await Promise.all([
    settings.notifyOverdueEnabled && modules.reminders
      ? prisma.pendingReminder.findMany({
          where: {
            AND: [
              notifiedFilter,
              { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    settings.notifyPendingEnabled && modules.subscriptions
      ? prisma.pendingEmail.findMany({
          where: notifiedFilter,
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const tasks: Promise<boolean>[] = [];

  if (unnotifiedReminders.length > 0) {
    const n = unnotifiedReminders.length;
    tasks.push(...buildChannelTasks(
      settings,
      `Überfällige Rechnungen – ${n} neue Mahnung(en)`,
      `${n} Rechnung(en) sind überfällig und erfordern eine Mahnung.`,
      "/invoices/reminders"
    ));
  }

  if (unnotifiedPending.length > 0) {
    const n = unnotifiedPending.length;
    tasks.push(...buildChannelTasks(
      settings,
      `Abo-Rechnungen zur Überprüfung – ${n} neue Rechnung(en)`,
      `${n} neue Abo-Rechnung(en) warten auf Überprüfung.`,
      "/invoices/pending"
    ));
  }

  if (tasks.length === 0) return;

  await Promise.allSettled(tasks);

  // Stamp exactly the records that were part of this notification — records
  // created during dispatch stay unstamped and are picked up by the next run
  const updateOps: Promise<unknown>[] = [];
  if (unnotifiedReminders.length > 0) {
    updateOps.push(
      prisma.pendingReminder.updateMany({
        where: { id: { in: unnotifiedReminders.map((r) => r.id) } },
        data: { adminNotifiedAt: now },
      })
    );
  }
  if (unnotifiedPending.length > 0) {
    updateOps.push(
      prisma.pendingEmail.updateMany({
        where: { id: { in: unnotifiedPending.map((p) => p.id) } },
        data: { adminNotifiedAt: now },
      })
    );
  }
  await Promise.all(updateOps);
}

function buildEmailBody(message: string, path: string): string {
  const appUrl = process.env.AUTH_URL?.replace(/\/$/, "");
  const link = appUrl ? `\n\nJetzt prüfen: ${appUrl}${path}` : "";
  return `${message}${link}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTelegramText(subject: string, message: string, path: string): string {
  const appUrl = process.env.AUTH_URL?.replace(/\/$/, "");
  const fullUrl = appUrl ? `${appUrl}${path}` : null;
  const link = fullUrl
    ? `\n\nJetzt prüfen: <a href="${fullUrl}">${escHtml(fullUrl)}</a>`
    : "";
  return `${escHtml(subject)}\n\n${escHtml(message)}${link}`;
}

/**
 * Sends one message to every configured admin channel (notify e-mail address,
 * Telegram) — the same channels as the daily overdue/pending notifications.
 * Each channel logs and swallows its own delivery errors. Returns whether at
 * least one channel delivered (a channel switched off by DISABLE_EMAIL /
 * DISABLE_TELEGRAM counts as handled), so callers can retry a failed message
 * later; false also when no channel is configured.
 */
export async function notifyAdmins(
  settings: FullSettings,
  subject: string,
  message: string,
  path: string
): Promise<boolean> {
  const results = await Promise.all(buildChannelTasks(settings, subject, message, path));
  return results.some(Boolean);
}

function buildChannelTasks(
  settings: FullSettings,
  subject: string,
  message: string,
  path: string
): Promise<boolean>[] {
  const tasks: Promise<boolean>[] = [];
  if (settings.notifyEmailAddress && hasSmtpSettings(settings)) {
    tasks.push(sendNotificationEmail(settings, subject, buildEmailBody(message, path)));
  }
  if (settings.notifyTelegramBotToken && settings.notifyTelegramChatId) {
    tasks.push(
      sendTelegramMessage(
        decryptSecret(settings.notifyTelegramBotToken),
        settings.notifyTelegramChatId,
        buildTelegramText(subject, message, path)
      )
    );
  }
  return tasks;
}

async function sendNotificationEmail(
  settings: FullSettings,
  subject: string,
  text: string
): Promise<boolean> {
  if (isEmailDisabled()) {
    log.info("Notification email suppressed (DISABLE_EMAIL=true)");
    return true;
  }
  try {
    await createSettingsTransport(settings).sendMail({
      from: settingsSender(settings),
      to: settings.notifyEmailAddress!,
      subject,
      text,
    });
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send notification email");
    return false;
  }
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  if (process.env.DISABLE_TELEGRAM === "true") {
    log.info("Telegram notification suppressed (DISABLE_TELEGRAM=true)");
    return true;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Telegram API ${res.status}: ${detail}`);
    }
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram notification");
    return false;
  }
}
