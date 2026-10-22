import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({})) } }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: vi.fn((v: string) => `dec:${v}`) }));

import nodemailer from "nodemailer";
import {
  createSettingsTransport,
  createSmtpTransport,
  hasSmtpSettings,
  isEmailDisabled,
  mailNotConfiguredError,
  SMTP_NOT_CONFIGURED_ERROR,
  settingsSender,
} from "@/lib/smtp";

function settings(overrides: Record<string, unknown> = {}) {
  return {
    smtpHost: "mail.test.ch",
    smtpPort: null,
    smtpUser: "user@test.ch",
    smtpPassword: "enc",
    smtpFromName: null,
    smtpFromAddress: null,
    companyInfo: { companyName: "Test AG" },
    ...overrides,
  } as never;
}

describe("smtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_EMAIL;
  });
  afterEach(() => {
    delete process.env.DISABLE_EMAIL;
  });

  it("isEmailDisabled reads DISABLE_EMAIL=true only", () => {
    expect(isEmailDisabled()).toBe(false);
    process.env.DISABLE_EMAIL = "1";
    expect(isEmailDisabled()).toBe(false);
    process.env.DISABLE_EMAIL = "true";
    expect(isEmailDisabled()).toBe(true);
  });

  it("defaults to port 587 without TLS and uses implicit TLS on 465", () => {
    createSmtpTransport({ host: "h", user: "u", pass: "p" });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith({
      host: "h",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    });
    createSmtpTransport({ host: "h", port: 465, user: "u", pass: "p" });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });

  it("builds the transport from the settings with the decrypted password", () => {
    createSettingsTransport(settings({ smtpPort: 25 }));
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "mail.test.ch",
      port: 25,
      secure: false,
      auth: { user: "user@test.ch", pass: "dec:enc" },
    });
  });

  it("refuses incomplete settings", () => {
    expect(() => createSettingsTransport(settings({ smtpPassword: null }))).toThrow("SMTP nicht konfiguriert");
    expect(hasSmtpSettings(settings({ smtpHost: "" }))).toBe(false);
    expect(hasSmtpSettings(settings())).toBe(true);
  });

  it("settingsSender falls back to company name and SMTP user", () => {
    expect(settingsSender(settings())).toBe('"Test AG" <user@test.ch>');
    expect(settingsSender(settings({ smtpFromName: "Büro", smtpFromAddress: "info@test.ch" }))).toBe(
      '"Büro" <info@test.ch>'
    );
    expect(settingsSender(settings({ companyInfo: { companyName: "" } }))).toBe('"user@test.ch" <user@test.ch>');
  });
});

describe("mailNotConfiguredError", () => {
  afterEach(() => {
    delete process.env.DISABLE_EMAIL;
  });

  it("reports missing SMTP settings before any number is assigned", () => {
    delete process.env.DISABLE_EMAIL;
    expect(mailNotConfiguredError({ smtpHost: null, smtpUser: null, smtpPassword: null })).toBe(SMTP_NOT_CONFIGURED_ERROR);
    expect(mailNotConfiguredError({ smtpHost: "h", smtpUser: "u", smtpPassword: "p" })).toBeNull();
  });

  it("does not complain while mail is switched off on purpose", () => {
    process.env.DISABLE_EMAIL = "true";
    expect(mailNotConfiguredError({ smtpHost: null, smtpUser: null, smtpPassword: null })).toBeNull();
  });
});
