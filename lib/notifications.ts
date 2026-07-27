import nodemailer from "nodemailer";
import cron from "node-cron";
import type { PrismaClient, ApplicationSettings, CompanyInformation } from "@prisma/client";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { checkAndUpdateAllDocumentStates } from "@/lib/state-manager";
import { checkOverdueInvoices } from "@/lib/reminders";
import { checkYearlyInvoices } from "@/lib/yearly-invoices";

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
    const { default: prisma } = await import("@/lib/prisma");
    try {
      await checkAndUpdateAllDocumentStates(prisma);
      await checkOverdueInvoices(prisma);
      await checkYearlyInvoices(prisma);
      const settings = await prisma.applicationSettings.findFirst({
        include: { companyInfo: true },
      });
      await sendAdminNotifications(prisma, settings);
    } catch (err) {
      log.error({ err }, "Daily notification cron failed");
    }
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

  const repeatCutoff = settings.notifyRepeatIntervalDays
    ? new Date(now.getTime() - settings.notifyRepeatIntervalDays * 24 * 60 * 60 * 1000)
    : null;
  const notifiedFilter = repeatCutoff
    ? { OR: [{ adminNotifiedAt: null }, { adminNotifiedAt: { lt: repeatCutoff } }] }
    : { adminNotifiedAt: null };

  const [unnotifiedReminders, unnotifiedPending] = await Promise.all([
    settings.notifyOverdueEnabled
      ? prisma.pendingReminder.findMany({
          where: notifiedFilter,
          select: { id: true },
        })
      : Promise.resolve([]),
    settings.notifyPendingEnabled
      ? prisma.pendingEmail.findMany({
          where: notifiedFilter,
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const tasks: Promise<void>[] = [];

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
      `Jahresrechnungen zur Überprüfung – ${n} neue Rechnung(en)`,
      `${n} neue Jahresrechnung(en) warten auf Überprüfung.`,
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

function buildChannelTasks(
  settings: FullSettings,
  subject: string,
  message: string,
  path: string
): Promise<void>[] {
  const tasks: Promise<void>[] = [];
  const hasSmtp =
    settings.notifyEmailAddress && settings.smtpHost && settings.smtpUser && settings.smtpPassword;
  if (hasSmtp) {
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
): Promise<void> {
  if (process.env.DISABLE_EMAIL === "true") {
    log.info("Notification email suppressed (DISABLE_EMAIL=true)");
    return;
  }
  try {
    const fromName =
      settings.smtpFromName ||
      settings.companyInfo.companyName ||
      settings.smtpUser!;
    const fromAddress = settings.smtpFromAddress || settings.smtpUser;
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost!,
      port: settings.smtpPort ?? 587,
      secure: (settings.smtpPort ?? 587) === 465,
      auth: { user: settings.smtpUser!, pass: decryptSecret(settings.smtpPassword!) },
    });
    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: settings.notifyEmailAddress!,
      subject,
      text,
    });
  } catch (err) {
    log.error({ err }, "Failed to send notification email");
  }
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  if (process.env.DISABLE_TELEGRAM === "true") {
    log.info("Telegram notification suppressed (DISABLE_TELEGRAM=true)");
    return;
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
  } catch (err) {
    log.error({ err }, "Failed to send Telegram notification");
  }
}
