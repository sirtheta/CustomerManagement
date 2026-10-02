"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import nodemailer from "nodemailer";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import logger from "@/lib/logger";
import { checkAndUpdateAllDocumentStates } from "@/lib/state-manager";
import { checkOverdueInvoices } from "@/lib/reminders";
import { checkSubscriptions } from "@/lib/subscriptions";
import { closeAnsweredFollowUps, notifyDueTasks } from "@/lib/tasks";
import { sendAdminNotifications } from "@/lib/notifications";
import { getEnabledModules, MODULE_KEYS, MODULE_FIELDS, MODULE_INFO } from "@/lib/modules";
import { validateIban } from "@/lib/iban";
import { ADDRESS_LIMITS, CREDITOR_COUNTRIES } from "@/lib/address";

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
    invoiceNumberPrefix: (formData.get("invoiceNumberPrefix") as string) || "R-",
    quoteNumberPrefix: (formData.get("quoteNumberPrefix") as string) || "A-",
    defaultYearlyInvoice: formData.get("defaultYearlyInvoice") === "on",
    useHolderNameOnQR: formData.get("useHolderNameOnQR") === "on",
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
    notifyOverdueEnabled: formData.get("notifyOverdueEnabled") === "on",
    notifyPendingEnabled: formData.get("notifyPendingEnabled") === "on",
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

  revalidatePath("/settings");
  return { success: true, _ts: Date.now() };
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

  const port = portRaw ? parseInt(portRaw) : 587;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

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

  if (process.env.DISABLE_EMAIL === "true") {
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

  const port = portRaw ? parseInt(portRaw) : 587;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
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
    await checkAndUpdateAllDocumentStates(prisma);
    const modules = await getEnabledModules(prisma);
    if (modules.reminders) await checkOverdueInvoices(prisma);
    if (modules.subscriptions) await checkSubscriptions(prisma);
    if (modules.tasks) await closeAnsweredFollowUps(prisma);
    // Reset notification stamps so the check always sends in dev
    await Promise.all([
      prisma.pendingReminder.updateMany({ data: { adminNotifiedAt: null } }),
      prisma.pendingEmail.updateMany({ data: { adminNotifiedAt: null } }),
      prisma.task.updateMany({ data: { notifiedAt: null } }),
    ]);
    const settings = await prisma.applicationSettings.findFirst({
      include: { companyInfo: true },
    });
    await sendAdminNotifications(prisma, settings);
    if (modules.tasks) await notifyDueTasks(prisma, settings);
    revalidatePath("/");
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

export async function saveModules(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) return { error: "Keine Einstellungen gefunden", _ts: Date.now() };

  const wanted = Object.fromEntries(
    MODULE_KEYS.map((key) => [key, formData.get(`module_${key}`) === "on"])
  ) as Record<(typeof MODULE_KEYS)[number], boolean>;

  // Active subscriptions would keep creating invoices in the background, and
  // drafts waiting for approval would be unreachable once the page is hidden.
  if (!wanted.subscriptions && settings.moduleSubscriptions) {
    const [activeSubscriptions, pendingEmails] = await Promise.all([
      prisma.subscription.count({ where: { active: true } }),
      prisma.pendingEmail.count(),
    ]);
    if (activeSubscriptions > 0) {
      return {
        _ts: Date.now(),
        error: `Abos können nicht ausgeblendet werden, solange noch ${activeSubscriptions} aktive Abos bestehen. Bitte zuerst alle Abos beenden.`,
      };
    }
    if (pendingEmails > 0) {
      return {
        _ts: Date.now(),
        error: `Abos können nicht ausgeblendet werden, solange noch ${pendingEmails} Abo-Rechnung(en) auf Freigabe warten.`,
      };
    }
  }

  const data = Object.fromEntries(MODULE_KEYS.map((key) => [MODULE_FIELDS[key], wanted[key]]));
  await prisma.applicationSettings.update({
    where: { applicationSettingsId: settings.applicationSettingsId },
    data,
  });

  const changed = MODULE_KEYS.filter((key) => settings[MODULE_FIELDS[key]] !== wanted[key]);
  if (changed.length > 0) {
    await logAudit(session, "UPDATE", "Settings", settings.applicationSettingsId, "Module", {
      ...Object.fromEntries(changed.map((key) => [MODULE_INFO[key].label, wanted[key] ? "ein" : "aus"])),
    });
  }

  // The navigation lives in the layout, so everything has to be re-rendered.
  revalidatePath("/", "layout");
  return { success: true, _ts: Date.now() };
}
