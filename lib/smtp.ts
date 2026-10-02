import nodemailer from "nodemailer";
import type { ApplicationSettings, CompanyInformation } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";

/**
 * SMTP transport and the `DISABLE_EMAIL` switch for every mail the app sends
 * (customer mails in lib/email.ts, admin notifications, the settings tests).
 */

/** `DISABLE_EMAIL=true` (tests, e2e, screenshots) suppresses every outgoing mail. */
export function isEmailDisabled(): boolean {
  return process.env.DISABLE_EMAIL === "true";
}

export const DEFAULT_SMTP_PORT = 587;

export type SmtpConnection = {
  host: string;
  /** Missing → 587 (STARTTLS); 465 means implicit TLS. */
  port?: number | null;
  user: string;
  /** Plain-text password (already decrypted). */
  pass: string;
};

/** Takes explicit values, so the settings page can test unsaved form input. */
export function createSmtpTransport({ host, port, user, pass }: SmtpConnection) {
  const effectivePort = port ?? DEFAULT_SMTP_PORT;
  return nodemailer.createTransport({
    host,
    port: effectivePort,
    secure: effectivePort === 465,
    auth: { user, pass },
  });
}

type SmtpSettings = Pick<
  ApplicationSettings,
  "smtpHost" | "smtpPort" | "smtpUser" | "smtpPassword" | "smtpFromName" | "smtpFromAddress"
> & { companyInfo: Pick<CompanyInformation, "companyName"> };

export function hasSmtpSettings(settings: Pick<ApplicationSettings, "smtpHost" | "smtpUser" | "smtpPassword">): boolean {
  return Boolean(settings.smtpHost && settings.smtpUser && settings.smtpPassword);
}

/** Transport from the stored settings (password decrypted); throws when SMTP is not configured. */
export function createSettingsTransport(settings: SmtpSettings) {
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
    throw new Error("SMTP nicht konfiguriert. Bitte SMTP-Einstellungen hinterlegen.");
  }
  return createSmtpTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    user: settings.smtpUser,
    pass: decryptSecret(settings.smtpPassword),
  });
}

export function formatSender(name: string, address: string): string {
  return `"${name}" <${address}>`;
}

/** From header of the stored settings: sender name, else company name, else the SMTP user. */
export function settingsSender(settings: SmtpSettings): string {
  const name = settings.smtpFromName || settings.companyInfo.companyName || settings.smtpUser || "";
  const address = settings.smtpFromAddress || settings.smtpUser || "";
  return formatSender(name, address);
}
