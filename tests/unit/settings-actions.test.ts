import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    applicationSettings: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    companyInformation: { update: vi.fn(), create: vi.fn() },
    category: { create: vi.fn(), update: vi.fn() },
    pendingReminder: { updateMany: vi.fn() },
    pendingEmail: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("sharp", () => ({
  default: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn((v: string) => `enc:${v}`),
  decryptSecret: vi.fn((v: string) => v.replace("enc:", "")),
}));
vi.mock("@/lib/state-manager", () => ({
  checkAndUpdateAllDocumentStates: vi.fn(),
}));
vi.mock("@/lib/reminders", () => ({ checkOverdueInvoices: vi.fn() }));
vi.mock("@/lib/yearly-invoices", () => ({ checkYearlyInvoices: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ sendAdminNotifications: vi.fn() }));
vi.mock("@/lib/pdf/theme", () => ({
  resolveTheme: vi.fn((v: unknown) => v),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  saveSettings,
  testSmtpConnection,
  removeLogo,
  testEmailNotification,
  triggerNotificationCheck,
  testTelegramNotification,
} from "@/app/(app)/settings/actions";
import {
  createCategory,
  updateCategory,
} from "@/app/(app)/settings/categories/actions";
import { savePdfTheme } from "@/app/(app)/settings/design/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import nodemailer from "nodemailer";
import sharp from "sharp";

const adminSession = {
  user: { id: "1", name: "Admin", email: "admin@test.ch", role: "Admin" },
} as never;
const editorSession = {
  user: { id: "2", name: "Editor", email: "editor@test.ch", role: "Editor" },
} as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_EMAIL;
    delete process.env.DISABLE_TELEGRAM;
  });

  describe("saveSettings", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      // requireAdmin redirects when role is insufficient; let redirect throw
      await expect(saveSettings({}, form({}))).rejects.toThrow();
      expect(prisma.applicationSettings.findFirst).not.toHaveBeenCalled();
    });

    it("returns error when paymentTermDays is less than 1", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await saveSettings({}, form({ defaultPaymentTermDays: "0" }));
      expect(result.error).toBe("Tage-Felder müssen mindestens 1 betragen.");
    });

    it("returns error when SMTP port is out of range", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await saveSettings({}, form({ smtpPort: "99999" }));
      expect(result.error).toBe("SMTP-Port muss zwischen 1 und 65535 liegen.");
    });

    it("updates existing settings and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      const result = await saveSettings(
        {},
        form({ companyName: "Muster AG", defaultPaymentTermDays: "30", smtpPort: "587" })
      );

      expect(result.success).toBe(true);
      expect(prisma.companyInformation.update).toHaveBeenCalledWith({
        where: { companyInformationId: 2 },
        data: expect.objectContaining({ companyName: "Muster AG" }),
      });
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({ defaultPaymentTermDays: 30, smtpPort: 587 }),
      });
      expect(revalidatePath).toHaveBeenCalledWith("/settings");
    });

    it("creates new settings when none exist", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.companyInformation.create).mockResolvedValue({
        companyInformationId: 10,
      } as never);
      vi.mocked(prisma.applicationSettings.create).mockResolvedValue({} as never);

      const result = await saveSettings({}, form({ companyName: "Neue AG" }));

      expect(result.success).toBe(true);
      expect(prisma.companyInformation.create).toHaveBeenCalled();
      expect(prisma.applicationSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyInformationId: 10 }),
      });
    });

    it("encrypts SMTP password when provided", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({ smtpPassword: "secret123" }));

      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({ smtpPassword: "enc:secret123" }),
      });
    });

    it("saves a configured smtpFromAddress", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
        smtpFromAddress: "old@test.ch",
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({ smtpFromAddress: "sanitaet@test.ch" }));

      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({ smtpFromAddress: "sanitaet@test.ch" }),
      });
    });

    it("clears a previously saved smtpFromAddress when submitted blank", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
        smtpFromAddress: "old@test.ch",
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({ smtpFromAddress: "" }));

      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({ smtpFromAddress: null }),
      });
    });

    it("uploads and converts logo to PNG", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      const mockSharpInstance = {
        resize: vi.fn().mockReturnThis(),
        png: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("pngdata")),
      };
      vi.mocked(sharp).mockReturnValue(mockSharpInstance as never);

      const logoFile = new File([Buffer.from("imgdata")], "logo.png", { type: "image/png" });
      const fd = new FormData();
      fd.set("logo", logoFile);

      const result = await saveSettings({}, fd);
      expect(result.success).toBe(true);
      expect(sharp).toHaveBeenCalled();
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(300, 300, expect.any(Object));
    });
  });

  describe("testSmtpConnection", () => {
    it("returns error when SMTP config is incomplete", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await testSmtpConnection({}, form({ smtpHost: "mail.example.com" }));
      expect(result.error).toBe("Bitte SMTP-Server, Benutzername und Passwort ausfüllen.");
    });

    it("returns success when SMTP verify passes", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const mockTransporter = { verify: vi.fn().mockResolvedValue(true) };
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as never);

      const result = await testSmtpConnection(
        {},
        form({ smtpHost: "mail.test.ch", smtpUser: "user", smtpPassword: "pass" })
      );
      expect(result.success).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it("returns error when SMTP verify fails", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const mockTransporter = {
        verify: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as never);

      const result = await testSmtpConnection(
        {},
        form({ smtpHost: "mail.test.ch", smtpUser: "user", smtpPassword: "pass" })
      );
      expect(result.error).toBe("SMTP-Fehler: Connection refused");
    });

    it("uses port 465 for secure connection", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const mockTransporter = { verify: vi.fn().mockResolvedValue(true) };
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as never);

      await testSmtpConnection(
        {},
        form({ smtpHost: "mail.test.ch", smtpPort: "465", smtpUser: "user", smtpPassword: "pw" })
      );
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true })
      );
    });
  });

  describe("removeLogo", () => {
    it("returns early when settings not found", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      await removeLogo();
      expect(prisma.companyInformation.update).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("removes logo and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        companyInformationId: 5,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);

      await removeLogo();
      expect(prisma.companyInformation.update).toHaveBeenCalledWith({
        where: { companyInformationId: 5 },
        data: { companyLogo: null },
      });
      expect(revalidatePath).toHaveBeenCalledWith("/settings");
    });
  });

  describe("testEmailNotification", () => {
    it("returns error when DISABLE_EMAIL is set", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      process.env.DISABLE_EMAIL = "true";
      const result = await testEmailNotification({}, form({}));
      expect(result.error).toContain("DISABLE_EMAIL=true");
    });

    it("returns error when to address is missing", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const result = await testEmailNotification({}, form({}));
      expect(result.error).toBe("Bitte eine Benachrichtigungs-E-Mail-Adresse eingeben.");
    });

    it("returns error when SMTP config is incomplete", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await testEmailNotification(
        {},
        form({ notifyEmailAddress: "notify@test.ch", smtpHost: "mail.test.ch" })
      );
      expect(result.error).toBe(
        "Bitte zuerst SMTP-Server, Benutzername und Passwort konfigurieren."
      );
    });

    it("sends test email and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const mockTransporter = { sendMail: vi.fn().mockResolvedValue({}) };
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as never);

      const result = await testEmailNotification(
        {},
        form({
          notifyEmailAddress: "notify@test.ch",
          smtpHost: "mail.test.ch",
          smtpUser: "user",
          smtpPassword: "pass",
        })
      );
      expect(result.success).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "notify@test.ch" })
      );
    });

    it("uses smtpFromAddress instead of smtpUser in the From header when set", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const mockTransporter = { sendMail: vi.fn().mockResolvedValue({}) };
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as never);

      await testEmailNotification(
        {},
        form({
          notifyEmailAddress: "notify@test.ch",
          smtpHost: "mail.test.ch",
          smtpUser: "info@test.ch",
          smtpPassword: "pass",
          smtpFromAddress: "sanitaet@test.ch",
        })
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.stringContaining("<sanitaet@test.ch>") })
      );
    });
  });

  describe("triggerNotificationCheck", () => {
    it("returns error in production environment", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const result = await triggerNotificationCheck();
      expect(result.error).toContain("Entwicklungsumgebungen");
      vi.unstubAllEnvs();
    });

    it("runs all checks and returns success in development", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.pendingReminder.updateMany).mockResolvedValue({ count: 0 } as never);
      vi.mocked(prisma.pendingEmail.updateMany).mockResolvedValue({ count: 0 } as never);

      const result = await triggerNotificationCheck();
      expect(result.success).toBe(true);
    });
  });

  describe("testTelegramNotification", () => {
    it("returns error when DISABLE_TELEGRAM is set", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      process.env.DISABLE_TELEGRAM = "true";
      const result = await testTelegramNotification({}, form({}));
      expect(result.error).toContain("DISABLE_TELEGRAM=true");
    });

    it("returns error when botToken or chatId is missing", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await testTelegramNotification({}, form({}));
      expect(result.error).toBe("Bitte Bot-Token und Chat-ID eingeben.");
    });

    it("returns success when Telegram API responds ok", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));

      const result = await testTelegramNotification(
        {},
        form({ notifyTelegramBotToken: "bot123", notifyTelegramChatId: "chat456" })
      );
      expect(result.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("returns error when Telegram API responds not ok", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "Bad Request" } as never)
      );

      const result = await testTelegramNotification(
        {},
        form({ notifyTelegramBotToken: "bot123", notifyTelegramChatId: "chat456" })
      );
      expect(result.error).toContain("Telegram-Fehler: Bad Request");
      vi.unstubAllGlobals();
    });
  });
});

describe("category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCategory", () => {
    it("rejects Editor role", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      await expect(createCategory({}, form({ name: "Test" }))).rejects.toThrow();
    });

    it("returns error for missing name", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const result = await createCategory({}, form({}));
      expect(result.error).toBe("Bezeichnung ist erforderlich.");
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it("creates category, logs audit, and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.category.create).mockResolvedValue({
        categoryId: 1,
        name: "Entwicklung",
        colorHex: "#3b82f6",
      } as never);

      const result = await createCategory({}, form({ name: "Entwicklung", colorHex: "#3b82f6" }));
      expect(result).toEqual({});
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: "Entwicklung", colorHex: "#3b82f6" },
      });
      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "CREATE",
        "Settings",
        1,
        "Entwicklung"
      );
      expect(revalidatePath).toHaveBeenCalledWith("/settings/categories");
    });

    it("sets colorHex to null when empty", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.category.create).mockResolvedValue({
        categoryId: 2,
        name: "Sonstiges",
      } as never);

      await createCategory({}, form({ name: "Sonstiges" }));
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: "Sonstiges", colorHex: null },
      });
    });
  });

  describe("updateCategory", () => {
    it("returns error for missing name", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      const result = await updateCategory(1, {}, form({}));
      expect(result.error).toBe("Bezeichnung ist erforderlich.");
    });

    it("updates category with isActive flag and logs audit", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.category.update).mockResolvedValue({
        categoryId: 3,
        name: "Design",
      } as never);

      await updateCategory(3, {}, form({ name: "Design", isActive: "on" }));
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { categoryId: 3 },
        data: { name: "Design", colorHex: null, isActive: true },
      });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "UPDATE", "Settings", 3, "Design");
      expect(revalidatePath).toHaveBeenCalledWith("/settings/categories");
    });

    it("sets isActive to false when checkbox not checked", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.category.update).mockResolvedValue({ categoryId: 4, name: "Alt" } as never);

      await updateCategory(4, {}, form({ name: "Alt" }));
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { categoryId: 4 },
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });
});

describe("design actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("savePdfTheme", () => {
    it("returns error when settings not found", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await savePdfTheme({}, form({ theme: '{"primaryColor":"#000"}' }));
      expect(result.error).toContain("Einstellungen");
    });

    it("returns error for invalid JSON", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
      } as never);
      const result = await savePdfTheme({}, form({ theme: "not-json" }));
      expect(result.error).toBe("Ungültige Design-Daten.");
    });

    it("saves PDF theme, logs audit, and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 7,
      } as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);
      const theme = { primaryColor: "#1d4ed8" };

      const result = await savePdfTheme({}, form({ theme: JSON.stringify(theme) }));
      expect(result.success).toBe(true);
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 7 },
        data: { pdfTheme: theme },
      });
      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "UPDATE",
        "Settings",
        undefined,
        "PDF-Design",
        expect.any(Object)
      );
      expect(revalidatePath).toHaveBeenCalledWith("/settings/design");
    });
  });
});
