"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { createSmtpTransport, DEFAULT_SMTP_PORT, formatSender, isEmailDisabled } from "@/lib/smtp";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import logger from "@/lib/logger";
import { runDailyJobs } from "@/lib/daily-jobs";
import { MODULE_KEYS, MODULE_FIELDS, MODULE_INFO, type ModuleKey } from "@/lib/modules";
import { validateIban } from "@/lib/iban";
import { ADDRESS_LIMITS, CREDITOR_COUNTRIES } from "@/lib/address";
import { DEFAULT_PREFIXES } from "@/lib/document-number";

const log = logger.child({ module: "settings" });

const PLAIN_DECIMAL = /^-?\d+([.,]\d+)?$/;
const MAX_REMINDER_FEE_RAPPEN = 10_000_000; // 100'000 CHF, keeps the value inside a 32-bit Int

export async function saveSettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });

  let companyIBAN: string | null = null;
  const ibanRaw = ((formData.get("companyIBAN") as string) ?? "").trim();
  if (ibanRaw) {
    const ibanCheck = validateIban(ibanRaw);
    if (!ibanCheck.valid) return { error: `Ungültige IBAN: ${ibanCheck.error}` };
    companyIBAN = ibanCheck.iban;
  }

  const logoFile = formData.get("logo") as File | null;
  let logoBytes: Uint8Array<ArrayBuffer> | null = null;
  if (logoFile && logoFile.size > 0) {
    const ab = await logoFile.arrayBuffer();
    // Always convert to PNG so pdfkit (which only supports PNG/JPEG) can render it
    const pngBuffer = await sharp(Buffer.from(ab))
      .resize(300, 300, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    logoBytes = new Uint8Array(pngBuffer.buffer as ArrayBuffer) as Uint8Array<ArrayBuffer>;
  }

  const companyCountry = ((formData.get("companyCountry") as string) || "CH").trim().toUpperCase();
  if (!(CREDITOR_COUNTRIES as readonly string[]).includes(companyCountry)) {
    return { error: "Für die QR-Rechnung muss die Firmenadresse in der Schweiz oder in Liechtenstein liegen." };
  }
  const addressTooLong =
    (String(formData.get("companyStreet") ?? "").trim().length > ADDRESS_LIMITS.street && "Strasse") ||
    (String(formData.get("companyHouseNumber") ?? "").trim().length > ADDRESS_LIMITS.houseNumber && "Hausnummer") ||
    (String(formData.get("companyZip") ?? "").trim().length > ADDRESS_LIMITS.zip && "PLZ") ||
    (String(formData.get("companyCity") ?? "").trim().length > ADDRESS_LIMITS.city && "Ort");
  if (addressTooLong) {
    return { error: `${addressTooLong} der Firmenadresse ist zu lang für die QR-Rechnung.` };
  }

  const companyData = {
    companyName: (formData.get("companyName") as string) || null,
    companyHolderName: (formData.get("companyHolderName") as string) || null,
    companyStreet: (formData.get("companyStreet") as string)?.trim() || null,
    companyHouseNumber: (formData.get("companyHouseNumber") as string)?.trim() || null,
    companyZip: (formData.get("companyZip") as string)?.trim() || null,
    companyCity: (formData.get("companyCity") as string)?.trim() || null,
    companyCountry,
    // Saving confirms the address, e.g. after the migration's automatic split.
    companyAddressNeedsReview: false,
    companyEmail: (formData.get("companyEmail") as string) || null,
    companyPhone: (formData.get("companyPhone") as string) || null,
    companyIBAN,
    ...(logoBytes ? { companyLogo: logoBytes } : {}),
  };

  const smtpPortRaw = formData.get("smtpPort") as string;
  const paymentTermDays = parseInt(formData.get("defaultPaymentTermDays") as string);
  const quoteValidityDays = parseInt(formData.get("defaultQuoteValidityDays") as string);
  const reminderCooldown = parseInt(formData.get("reminderCooldownDays") as string);
  const feeToRappen = (name: string) => {
    const raw = (formData.get(name) as string | null)?.trim();
    if (!raw) return 0;
    if (!PLAIN_DECIMAL.test(raw)) return NaN;
    return Math.round(Number(raw.replace(",", ".")) * 100);
  };
  const feeLevel2 = feeToRappen("reminderFeeLevel2");
  const feeLevel3 = feeToRappen("reminderFeeLevel3");
  const feeLevel4 = feeToRappen("reminderFeeLevel4");
  const interestRaw = (formData.get("reminderInterestPercent") as string | null)?.trim();
  const interestPercent = !interestRaw
    ? 0
    : PLAIN_DECIMAL.test(interestRaw)
      ? Number(interestRaw.replace(",", "."))
      : NaN;
  const notifyRepeatRaw = (formData.get("notifyRepeatIntervalDays") as string)?.trim();
  const notifyRepeatInterval = notifyRepeatRaw ? parseInt(notifyRepeatRaw) : NaN;
  const smtpPort = smtpPortRaw ? parseInt(smtpPortRaw) : null;

  if ((!isNaN(paymentTermDays) && paymentTermDays < 1) ||
      (!isNaN(quoteValidityDays) && quoteValidityDays < 1) ||
      (!isNaN(reminderCooldown) && reminderCooldown < 1)) {
    return { error: "Tage-Felder müssen mindestens 1 betragen." };
  }
  if ([feeLevel2, feeLevel3, feeLevel4].some((fee) => Number.isNaN(fee)) || Number.isNaN(interestPercent)) {
    return { error: "Ungültiger Betrag." };
  }
  if ([feeLevel2, feeLevel3, feeLevel4].some((fee) => fee < 0)) {
    return { error: "Mahngebühren dürfen nicht negativ sein." };
  }
  if ([feeLevel2, feeLevel3, feeLevel4].some((fee) => fee > MAX_REMINDER_FEE_RAPPEN)) {
    return { error: "Ungültiger Betrag." };
  }
  if (interestPercent < 0 || interestPercent > 100) {
    return { error: "Der Verzugszins muss zwischen 0 und 100 % liegen." };
  }
  if (smtpPort !== null && (!isNaN(smtpPort)) && (smtpPort < 1 || smtpPort > 65535)) {
    return { error: "SMTP-Port muss zwischen 1 und 65535 liegen." };
  }

  const appData = {
    numberFormat: (formData.get("numberFormat") as string) || "de-CH",
    defaultPaymentTermDays: isNaN(paymentTermDays) ? 30 : paymentTermDays,
    defaultQuoteValidityDays: isNaN(quoteValidityDays) ? 30 : quoteValidityDays,
    invoiceNumberPrefix: (formData.get("invoiceNumberPrefix") as string) || DEFAULT_PREFIXES.invoice,
    quoteNumberPrefix: (formData.get("quoteNumberPrefix") as string) || DEFAULT_PREFIXES.quote,
    smtpHost: (formData.get("smtpHost") as string) || null,
    smtpPort: (smtpPort !== null && !isNaN(smtpPort)) ? smtpPort : null,
    smtpUser: (formData.get("smtpUser") as string) || null,
    // Secrets are stored encrypted; an empty field keeps the stored value
    // (the form never prefills secrets)
    smtpPassword: (formData.get("smtpPassword") as string)
      ? encryptSecret(formData.get("smtpPassword") as string)
      : settings?.smtpPassword ?? null,
    smtpFromName: (formData.get("smtpFromName") as string) || null,
    smtpFromAddress: (formData.get("smtpFromAddress") as string) || null,
    emailSubjectTemplate: (formData.get("emailSubjectTemplate") as string) || null,
    emailBodyTemplate: (formData.get("emailBodyTemplate") as string) || null,
    reminderCooldownDays: isNaN(reminderCooldown) ? 14 : reminderCooldown,
    reminderFeeLevel2Rappen: feeLevel2,
    reminderFeeLevel3Rappen: feeLevel3,
    reminderFeeLevel4Rappen: feeLevel4,
    reminderInterestPercent: interestPercent,
    notifyEmailAddress: (formData.get("notifyEmailAddress") as string)?.trim() || null,
    notifyTelegramBotToken: (formData.get("notifyTelegramBotToken") as string)?.trim()
      ? encryptSecret((formData.get("notifyTelegramBotToken") as string).trim())
      : settings?.notifyTelegramBotToken ?? null,
    notifyTelegramChatId: (formData.get("notifyTelegramChatId") as string)?.trim() || null,
    notifyRepeatIntervalDays: (!isNaN(notifyRepeatInterval) && notifyRepeatInterval >= 1) ? notifyRepeatInterval : null,
  };

  if (settings) {
    await prisma.companyInformation.update({
      where: { companyInformationId: settings.companyInformationId },
      data: companyData,
    });
    await prisma.applicationSettings.update({
      where: { applicationSettingsId: settings.applicationSettingsId },
      data: appData,
    });
  } else {
    const company = await prisma.companyInformation.create({ data: companyData });
    await prisma.applicationSettings.create({
      data: { ...appData, companyInformationId: company.companyInformationId },
    });
  }

  const dunningChanged =
    (settings?.reminderFeeLevel2Rappen ?? 0) !== feeLevel2 ||
    (settings?.reminderFeeLevel3Rappen ?? 0) !== feeLevel3 ||
    (settings?.reminderFeeLevel4Rappen ?? 0) !== feeLevel4 ||
    Number(settings?.reminderInterestPercent ?? 0) !== interestPercent;
  if (dunningChanged) {
    await logAudit(session, "UPDATE", "Settings", settings?.applicationSettingsId, "Mahnwesen", {
      reminderFeeLevel2Rappen: feeLevel2,
      reminderFeeLevel3Rappen: feeLevel3,
      reminderFeeLevel4Rappen: feeLevel4,
      reminderInterestPercent: interestPercent,
    });
  }

  const sensitiveChanges = diffSensitiveSettings(
    { ...settings, companyIBAN: settings?.companyInfo?.companyIBAN ?? null },
    { ...appData, companyIBAN }
  );
  if (sensitiveChanges) {
    await logAudit(session, "UPDATE", "Settings", settings?.applicationSettingsId, "Einstellungen", sensitiveChanges);
  }

  revalidatePath("/settings");
  return { success: true, _ts: Date.now() };
}

// Fields that redirect money or mail (QR account, sender, numbering, admin channels)
// are audited with old and new value; secrets only as changed, never in clear text.
const AUDITED_SETTINGS = [
  "companyIBAN",
  "invoiceNumberPrefix",
  "quoteNumberPrefix",
  "smtpHost",
  "smtpUser",
  "smtpPassword",
  "smtpFromAddress",
  "notifyEmailAddress",
  "notifyTelegramBotToken",
  "notifyTelegramChatId",
] as const;
const SECRET_SETTINGS = new Set<string>(["smtpPassword", "notifyTelegramBotToken"]);

type AuditedSettings = Partial<Record<(typeof AUDITED_SETTINGS)[number], string | null>>;

function diffSensitiveSettings(
  before: AuditedSettings,
  after: AuditedSettings
): Record<string, unknown> | null {
  const changed: string[] = [];
  const details: Record<string, unknown> = {};
  for (const key of AUDITED_SETTINGS) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from === to) continue;
    changed.push(key);
    details[key] = SECRET_SETTINGS.has(key) ? "geändert" : { from, to };
  }
  return changed.length > 0 ? { changed, ...details } : null;
}

export async function uploadLogo(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) return { error: "Keine Einstellungen gefunden" };

  const logoFile = formData.get("logo") as File | null;
  if (!logoFile || logoFile.size === 0) return { error: "Keine Datei ausgewählt" };

  const ab = await logoFile.arrayBuffer();
  const pngBuffer = await sharp(Buffer.from(ab))
    .resize(300, 300, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const logoBytes = new Uint8Array(pngBuffer.buffer as ArrayBuffer) as Uint8Array<ArrayBuffer>;

  await prisma.companyInformation.update({
    where: { companyInformationId: settings.companyInformationId },
    data: { companyLogo: logoBytes },
  });

  revalidatePath("/settings");
  return { success: true, _ts: Date.now() };
}

// The form never prefills secrets, so a blank field means "use the stored value"
async function resolveStoredSecret(
  formValue: string | undefined,
  stored: () => Promise<string | null | undefined>
): Promise<string | undefined> {
  if (formValue) return formValue;
  const value = await stored();
  return value ? decryptSecret(value) || undefined : undefined;
}

export async function testSmtpConnection(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  const host = (formData.get("smtpHost") as string | null)?.trim();
  const portRaw = formData.get("smtpPort") as string | null;
  const user = (formData.get("smtpUser") as string | null)?.trim();
  const pass = await resolveStoredSecret(
    (formData.get("smtpPassword") as string | null)?.trim(),
    async () => (await prisma.applicationSettings.findFirst())?.smtpPassword
  );

  if (!host || !user || !pass) {
    return { error: "Bitte SMTP-Server, Benutzername und Passwort ausfüllen." };
  }

  const port = portRaw ? parseInt(portRaw) : DEFAULT_SMTP_PORT;
  const transporter = createSmtpTransport({ host, port, user, pass });

  try {
    await transporter.verify();
    return { success: true, _ts: Date.now() };
  } catch (err) {
    log.error({ host, port, user, err }, "SMTP connection test failed");
    const message = err instanceof Error ? err.message : "Verbindung fehlgeschlagen.";
    return { error: `SMTP-Fehler: ${message}` };
  }
}

export async function removeLogo() {
  await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) return;
  await prisma.companyInformation.update({
    where: { companyInformationId: settings.companyInformationId },
    data: { companyLogo: null },
  });
  revalidatePath("/settings");
}

export async function testEmailNotification(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  if (isEmailDisabled()) {
    return { error: "E-Mail-Versand ist in dieser Umgebung deaktiviert (DISABLE_EMAIL=true)." };
  }

  const to = (formData.get("notifyEmailAddress") as string | null)?.trim();
  const host = (formData.get("smtpHost") as string | null)?.trim();
  const portRaw = formData.get("smtpPort") as string | null;
  const user = (formData.get("smtpUser") as string | null)?.trim();
  const pass = await resolveStoredSecret(
    (formData.get("smtpPassword") as string | null)?.trim(),
    async () => (await prisma.applicationSettings.findFirst())?.smtpPassword
  );
  const fromName = (formData.get("smtpFromName") as string | null)?.trim() || user || "";
  const fromAddress = (formData.get("smtpFromAddress") as string | null)?.trim() || user;

  if (!to) return { error: "Bitte eine Benachrichtigungs-E-Mail-Adresse eingeben." };
  if (!host || !user || !pass) {
    return { error: "Bitte zuerst SMTP-Server, Benutzername und Passwort konfigurieren." };
  }

  const port = portRaw ? parseInt(portRaw) : DEFAULT_SMTP_PORT;
  const transporter = createSmtpTransport({ host, port, user, pass });

  try {
    await transporter.sendMail({
      from: formatSender(fromName, fromAddress || user),
      to,
      subject: "Test-Benachrichtigung – CustomerManagement",
      text: "Dies ist eine Test-Benachrichtigung von CustomerManagement. Die E-Mail-Benachrichtigungen sind korrekt konfiguriert.",
    });
    return { success: true, _ts: Date.now() };
  } catch (err) {
    log.error({ host, port, user, to, err }, "Notification email test failed");
    const message = err instanceof Error ? err.message : "Senden fehlgeschlagen.";
    return { error: `E-Mail-Fehler: ${message}` };
  }
}

export async function triggerNotificationCheck(): Promise<ActionState> {
  if (process.env.NODE_ENV === "production") {
    return { error: "Nur in Entwicklungsumgebungen verfügbar." };
  }
  await requireAdmin();
  try {
    // Reset notification stamps so the check always sends in dev
    await Promise.all([
      prisma.pendingReminder.updateMany({ data: { adminNotifiedAt: null } }),
      prisma.pendingEmail.updateMany({ data: { adminNotifiedAt: null } }),
      prisma.task.updateMany({ data: { notifiedAt: null } }),
    ]);
    const failures = await runDailyJobs(prisma);
    revalidatePath("/");
    if (failures.length > 0) {
      return { error: `Fehler: ${failures.map((f) => `${f.step}: ${f.error}`).join("; ")}` };
    }
    return { success: true, _ts: Date.now() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { error: `Fehler: ${message}` };
  }
}

export async function testTelegramNotification(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireAdmin();

  if (process.env.DISABLE_TELEGRAM === "true") {
    return { error: "Telegram-Versand ist in dieser Umgebung deaktiviert (DISABLE_TELEGRAM=true)." };
  }

  const botToken = await resolveStoredSecret(
    (formData.get("notifyTelegramBotToken") as string | null)?.trim(),
    async () => (await prisma.applicationSettings.findFirst())?.notifyTelegramBotToken
  );
  const chatId =
    (formData.get("notifyTelegramChatId") as string | null)?.trim() ||
    (await prisma.applicationSettings.findFirst())?.notifyTelegramChatId ||
    undefined;

  if (!botToken || !chatId) {
    return { error: "Bitte Bot-Token und Chat-ID eingeben." };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Test-Benachrichtigung von CustomerManagement. Telegram-Integration ist korrekt konfiguriert.",
        }),
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      log.error({ chatId, status: res.status, detail }, "Telegram notification test failed");
      return { error: `Telegram-Fehler: ${detail}` };
    }
    return { success: true, _ts: Date.now() };
  } catch (err) {
    log.error({ chatId, err }, "Telegram notification test failed");
    const message = err instanceof Error ? err.message : "Anfrage fehlgeschlagen.";
    return { error: `Telegram-Fehler: ${message}` };
  }
}

/**
 * A module can only be switched off while this returns null; otherwise it
 * returns the reason. Modules without an entry can always be hidden.
 */
const MODULE_BLOCKERS: Partial<Record<ModuleKey, () => Promise<string | null>>> = {
  // Active subscriptions would keep creating invoices in the background, and
  // drafts waiting for approval would be unreachable once the page is hidden.
  // Subscriptions of archived customers never run (daily job, overview), so they do not count.
  subscriptions: async () => {
    const [activeSubscriptions, pendingEmails] = await Promise.all([
      prisma.subscription.count({ where: { active: true, customer: { archivedAt: null } } }),
      prisma.pendingEmail.count(),
    ]);
    if (activeSubscriptions > 0) {
      const state =
        activeSubscriptions === 1 ? "Es besteht noch 1 aktives Abo." : `Es bestehen noch ${activeSubscriptions} aktive Abos.`;
      return `${state} Bitte zuerst alle Abos pausieren («Alle Abos pausieren» unter Module).`;
    }
    if (pendingEmails > 0) {
      const state =
        pendingEmails === 1 ? "Es wartet noch 1 Abo-Rechnung" : `Es warten noch ${pendingEmails} Abo-Rechnungen`;
      return `${state} auf Freigabe. Bitte unter «Ausstehende E-Mails» freigeben oder verwerfen.`;
    }
    return null;
  },
};

/**
 * Pauses every active subscription so the Abos module can be switched off.
 * Paused subscriptions keep their date and can be resumed later; the audit
 * trail gets one `UPDATE Subscription` entry per subscription, as when
 * pausing one by one. Subscriptions of archived customers are left alone: they
 * never run and are not counted by the blocker.
 */
export async function pauseAllSubscriptions(): Promise<ActionState & { paused?: number }> {
  const session = await requireAdmin();
  const active = await prisma.subscription.findMany({
    where: { active: true, customer: { archivedAt: null } },
    select: { id: true, customerId: true },
  });
  if (active.length === 0) return { success: true, paused: 0 };

  // One by one: only a subscription that was really paused here (not meanwhile by someone else) is audited and counted.
  let paused = 0;
  for (const sub of active) {
    const { count } = await prisma.subscription.updateMany({
      where: { id: sub.id, active: true },
      data: { active: false },
    });
    if (count === 0) continue;
    paused += count;
    await logAudit(session, "UPDATE", "Subscription", sub.id, undefined, { customerId: sub.customerId, active: false });
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/subscriptions");
  return { success: true, paused };
}

/**
 * Switches one module on or off, saved the moment the checkbox is clicked. A
 * refused switch-off returns the reason and changes nothing, the checkbox
 * snaps back.
 */
export async function setModule(key: string, enabled: boolean): Promise<ActionState> {
  const session = await requireAdmin();
  if (!(MODULE_KEYS as readonly string[]).includes(key)) return { error: "Unbekanntes Modul." };
  const moduleKey = key as ModuleKey;

  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) return { error: "Keine Einstellungen gefunden" };
  if (settings[MODULE_FIELDS[moduleKey]] === enabled) return { success: true };

  if (!enabled) {
    const reason = await MODULE_BLOCKERS[moduleKey]?.();
    if (reason) return { error: `${MODULE_INFO[moduleKey].label} bleibt eingeschaltet: ${reason}` };
  }

  await prisma.applicationSettings.update({
    where: { applicationSettingsId: settings.applicationSettingsId },
    data: { [MODULE_FIELDS[moduleKey]]: enabled },
  });
  await logAudit(session, "UPDATE", "Settings", settings.applicationSettingsId, "Module", {
    [MODULE_INFO[moduleKey].label]: enabled ? "ein" : "aus",
  });

  // The navigation lives in the layout, so everything has to be re-rendered.
  revalidatePath("/", "layout");
  return { success: true };
}

// Checkboxes in the settings form that save on click instead of with the form
// (the value is the audit label, null = not audited). saveSettings leaves them alone.
const IMMEDIATE_SETTINGS = {
  useHolderNameOnQR: null,
  roundTotalTo5Rappen: "Rundung",
  notifyOverdueEnabled: null,
  notifyPendingEnabled: null,
} as const;

export type ImmediateSettingKey = keyof typeof IMMEDIATE_SETTINGS;

export async function setSetting(key: string, value: boolean): Promise<ActionState> {
  const session = await requireAdmin();
  if (!Object.hasOwn(IMMEDIATE_SETTINGS, key)) return { error: "Unbekannte Einstellung." };
  const settingKey = key as ImmediateSettingKey;

  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) return { error: "Bitte zuerst die Einstellungen speichern." };
  if (settings[settingKey] === value) return { success: true };

  await prisma.applicationSettings.update({
    where: { applicationSettingsId: settings.applicationSettingsId },
    data: { [settingKey]: value },
  });
  const auditLabel = IMMEDIATE_SETTINGS[settingKey];
  if (auditLabel) {
    await logAudit(session, "UPDATE", "Settings", settings.applicationSettingsId, auditLabel, {
      [settingKey]: value,
    });
  }

  revalidatePath("/settings");
  return { success: true };
}
