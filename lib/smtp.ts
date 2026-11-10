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

/**
 * True when host and user still point at the stored SMTP account. The stored
 * password may only be reused (blank password field, test buttons) while this
 * holds; for a changed target the password has to be typed again, so it can
 * never be sent to a server the person did not enter it for.
 */
export function isSameSmtpTarget(
  stored: { smtpHost: string | null; smtpUser: string | null } | null | undefined,
  host: string | null | undefined,
  user: string | null | undefined
): boolean {
  if (!stored) return false;
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  return norm(stored.smtpHost).toLowerCase() === norm(host).toLowerCase() && norm(stored.smtpUser) === norm(user);
}

export const SMTP_PASSWORD_REENTER_ERROR =
  "Server oder Benutzername wurden geändert: Bitte das SMTP-Passwort erneut eingeben.";

export const SMTP_NOT_CONFIGURED_ERROR =
  "E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail Versand). Es wurde nichts versendet und keine Nummer vergeben.";

/** Error text when a customer mail cannot go out because SMTP is missing; null when sending can work. */
export function mailNotConfiguredError(
  settings: Pick<ApplicationSettings, "smtpHost" | "smtpUser" | "smtpPassword">
): string | null {
  return isEmailDisabled() || hasSmtpSettings(settings) ? null : SMTP_NOT_CONFIGURED_ERROR;
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
