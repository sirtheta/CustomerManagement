import { describe, it, expect, vi, beforeEach } from "vitest";

// The stored SMTP password is never shown, and a blank password field means
// "keep the stored one". That shortcut must only apply while the server and
// user are unchanged: otherwise an admin (or anyone holding an admin session)
// could point the host at a server they control and have the stored
// credentials sent there, via the test buttons or by saving.

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    companyInformation: { update: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  decryptSecret: vi.fn((v: string) => v.replace("enc:", "")),
}));
vi.mock("@/lib/daily-jobs", () => ({ runDailyJobs: vi.fn(async () => []) }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { saveSettings, testSmtpConnection, testEmailNotification } from "@/app/(app)/settings/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import nodemailer from "nodemailer";

const adminSession = { user: { id: "1", name: "Admin", email: "admin@test.ch", role: "Admin" } } as never;

const STORED = {
  applicationSettingsId: 1,
  companyInformationId: 2,
  companyInfo: { companyIBAN: null },
  invoiceNumberPrefix: "I-",
  quoteNumberPrefix: "Q-",
  smtpHost: "mail.company.ch",
  smtpUser: "billing",
  smtpPassword: "enc:stored-secret",
  smtpFromAddress: null,
  notifyEmailAddress: null,
  notifyTelegramBotToken: null,
  notifyTelegramChatId: null,
};

const REENTER = "Server oder Benutzername wurden geändert: Bitte das SMTP-Passwort erneut eingeben.";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("SMTP password reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_EMAIL;
    vi.mocked(auth).mockResolvedValue(adminSession);
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(STORED as never);
    vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
    vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({}),
    } as never);
  });

  describe("testSmtpConnection", () => {
    it("does not send the stored password to a different host", async () => {
      const result = await testSmtpConnection({}, form({ smtpHost: "evil.example.com", smtpUser: "billing" }));
      expect(result.error).toBe(REENTER);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it("does not send the stored password with a different user", async () => {
      const result = await testSmtpConnection({}, form({ smtpHost: "mail.company.ch", smtpUser: "someone-else" }));
      expect(result.error).toBe(REENTER);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it("still uses the stored password while host and user are unchanged", async () => {
      const result = await testSmtpConnection({}, form({ smtpHost: " MAIL.company.ch ", smtpUser: "billing" }));
      expect(result.success).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: "MAIL.company.ch", auth: { user: "billing", pass: "stored-secret" } })
      );
    });

    it("accepts a typed password for a new host", async () => {
      const result = await testSmtpConnection(
        {},
        form({ smtpHost: "other.example.com", smtpUser: "billing", smtpPassword: "typed" })
      );
      expect(result.success).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: "billing", pass: "typed" } })
      );
    });
  });

  describe("testEmailNotification", () => {
    it("does not send the stored password to a different host", async () => {
      const result = await testEmailNotification(
        {},
        form({ notifyEmailAddress: "n@test.ch", smtpHost: "evil.example.com", smtpUser: "billing" })
      );
      expect(result.error).toBe(REENTER);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it("still uses the stored password while host and user are unchanged", async () => {
      const result = await testEmailNotification(
        {},
        form({ notifyEmailAddress: "n@test.ch", smtpHost: "mail.company.ch", smtpUser: "billing" })
      );
      expect(result.success).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: "billing", pass: "stored-secret" } })
      );
    });
  });

  describe("saveSettings", () => {
    it("refuses to keep the stored password when the host changes", async () => {
      const result = await saveSettings({}, form({ smtpHost: "evil.example.com", smtpUser: "billing" }));
      expect(result.error).toBe(REENTER);
      expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
    });

    it("refuses to keep the stored password when the user changes", async () => {
      const result = await saveSettings({}, form({ smtpHost: "mail.company.ch", smtpUser: "other" }));
      expect(result.error).toBe(REENTER);
      expect(prisma.applicationSettings.update).not.toHaveBeenCalled();
    });

    it("keeps the stored password while host and user are unchanged", async () => {
      const result = await saveSettings({}, form({ smtpHost: "mail.company.ch", smtpUser: "billing" }));
      expect(result.success).toBe(true);
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ smtpPassword: "enc:stored-secret" }) })
      );
    });

    it("stores a newly typed password together with a new host", async () => {
      const result = await saveSettings(
        {},
        form({ smtpHost: "new.example.com", smtpUser: "billing", smtpPassword: "typed" })
      );
      expect(result.success).toBe(true);
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ smtpPassword: "enc:typed" }) })
      );
    });

    it("drops the stored password when the SMTP configuration is cleared", async () => {
      const result = await saveSettings({}, form({}));
      expect(result.success).toBe(true);
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ smtpHost: null, smtpUser: null, smtpPassword: null }),
        })
      );
    });
  });
});
