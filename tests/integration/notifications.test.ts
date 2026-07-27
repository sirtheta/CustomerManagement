import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { sendAdminNotifications } from "@/lib/notifications";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn(), validate: vi.fn(() => true) } }));

const mockSendMail = vi.fn().mockResolvedValue({});
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

const mockFetch = vi.fn();

function baseSettings() {
  return {
    applicationSettingsId: 1,
    numberFormat: "de-CH",
    defaultPaymentTermDays: 30,
    defaultQuoteValidityDays: 30,
    invoiceNumberPrefix: "R-",
    quoteNumberPrefix: "A-",
    defaultYearlyInvoice: false,
    useHolderNameOnQR: false,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpUser: "user@example.com",
    smtpPassword: "secret",
    smtpFromName: "Test AG",
    smtpFromAddress: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    reminderCooldownDays: 14,
    notifyOverdueEnabled: true,
    notifyPendingEnabled: true,
    notifyEmailAddress: "admin@example.com",
    notifyTelegramBotToken: "bot123:token",
    notifyTelegramChatId: "12345",
    notifyRepeatIntervalDays: null,
    pdfTheme: null,
    companyInformationId: 1,
    companyInfo: {
      companyInformationId: 1,
      companyName: "Test AG",
      companyHolderName: null,
      companyAddress: null,
      companyZip: null,
      companyCity: null,
      companyEmail: null,
      companyPhone: null,
      companyIBAN: null,
      companyLogo: null,
    },
  };
}

const pastDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

describe("sendAdminNotifications", () => {
  const db = createTestDatabase();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
    mockSendMail.mockClear();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedOverdueReminder(docNum: string) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: docNum,
        date: pastDate(40),
        dueDate: pastDate(5),
        totalAmount: 500,
        state: "Overdue",
      },
    });
    return db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id } });
  }

  async function seedPendingEmail(docNum: string) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: docNum,
        date: pastDate(10),
        dueDate: pastDate(0),
        totalAmount: 200,
        state: "Draft",
      },
    });
    return db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "customer@example.com", subject: "Rechnung", body: "..." },
    });
  }

  it("does nothing when there are no unnotified records", async () => {
    await sendAdminNotifications(db.prisma, baseSettings());
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when settings is null", async () => {
    await seedOverdueReminder("N-001");
    await sendAdminNotifications(db.prisma, null);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when both flags are disabled", async () => {
    await seedOverdueReminder("N-002");
    const s = { ...baseSettings(), notifyOverdueEnabled: false, notifyPendingEnabled: false };
    await sendAdminNotifications(db.prisma, s);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips overdue notification when notifyOverdueEnabled is false", async () => {
    await seedOverdueReminder("N-003");
    const s = { ...baseSettings(), notifyOverdueEnabled: false };
    await sendAdminNotifications(db.prisma, s);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("skips pending notification when notifyPendingEnabled is false", async () => {
    await seedPendingEmail("N-004");
    const s = { ...baseSettings(), notifyPendingEnabled: false };
    await sendAdminNotifications(db.prisma, s);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends email notification for unnotified overdue reminders", async () => {
    await seedOverdueReminder("N-005");
    const s = { ...baseSettings(), notifyTelegramBotToken: null, notifyTelegramChatId: null };
    await sendAdminNotifications(db.prisma, s);
    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe("admin@example.com");
    expect(call.subject).toContain("1");
    expect(call.from).toContain("<user@example.com>");
  });

  it("uses smtpFromAddress instead of smtpUser in the From header when set", async () => {
    await seedOverdueReminder("N-005b");
    const s = {
      ...baseSettings(),
      smtpFromAddress: "sanitaet@example.com",
      notifyTelegramBotToken: null,
      notifyTelegramChatId: null,
    };
    await sendAdminNotifications(db.prisma, s);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toContain("<sanitaet@example.com>");
  });

  it("sends email notification for unnotified pending emails", async () => {
    await seedPendingEmail("N-006");
    const s = {
      ...baseSettings(),
      notifyOverdueEnabled: false,
      notifyTelegramBotToken: null,
      notifyTelegramChatId: null,
    };
    await sendAdminNotifications(db.prisma, s);
    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain("1");
  });

  it("sends Telegram message for unnotified overdue reminders", async () => {
    await seedOverdueReminder("N-007");
    const s = { ...baseSettings(), notifyEmailAddress: null };
    await sendAdminNotifications(db.prisma, s);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("api.telegram.org/bot");
    expect(url).toContain("sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("12345");
    expect(body.text).toContain("1");
  });

  it("sends Telegram message for unnotified pending emails", async () => {
    await seedPendingEmail("N-008");
    const s = {
      ...baseSettings(),
      notifyOverdueEnabled: false,
      notifyEmailAddress: null,
    };
    await sendAdminNotifications(db.prisma, s);
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("1");
  });

  it("sends both email and Telegram when both configured", async () => {
    await seedOverdueReminder("N-009");
    await sendAdminNotifications(db.prisma, baseSettings());
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("includes count in notification when multiple reminders are unnotified", async () => {
    await seedOverdueReminder("N-010");
    await seedOverdueReminder("N-011");
    await seedOverdueReminder("N-012");
    const s = { ...baseSettings(), notifyTelegramBotToken: null, notifyTelegramChatId: null };
    await sendAdminNotifications(db.prisma, s);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain("3");
  });

  it("email failure does not prevent Telegram notification", async () => {
    await seedOverdueReminder("N-013");
    mockSendMail.mockRejectedValueOnce(new Error("SMTP down"));
    await expect(sendAdminNotifications(db.prisma, baseSettings())).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("Telegram failure does not prevent email notification", async () => {
    await seedOverdueReminder("N-014");
    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => "Bad request" });
    await expect(sendAdminNotifications(db.prisma, baseSettings())).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it("never throws even when both channels fail", async () => {
    await seedOverdueReminder("N-015");
    mockSendMail.mockRejectedValueOnce(new Error("SMTP down"));
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    await expect(sendAdminNotifications(db.prisma, baseSettings())).resolves.toBeUndefined();
  });

  it("stamps adminNotifiedAt on processed PendingReminders after dispatch", async () => {
    const reminder = await seedOverdueReminder("N-016");
    await sendAdminNotifications(db.prisma, baseSettings());
    const updated = await db.prisma.pendingReminder.findUnique({ where: { id: reminder.id } });
    expect(updated!.adminNotifiedAt).not.toBeNull();
  });

  it("stamps adminNotifiedAt on processed PendingEmails after dispatch", async () => {
    const pending = await seedPendingEmail("N-017");
    const s = { ...baseSettings(), notifyOverdueEnabled: false };
    await sendAdminNotifications(db.prisma, s);
    const updated = await db.prisma.pendingEmail.findUnique({ where: { id: pending.id } });
    expect(updated!.adminNotifiedAt).not.toBeNull();
  });

  it("does not stamp adminNotifiedAt when flag is disabled for that type", async () => {
    const pending = await seedPendingEmail("N-018");
    const s = { ...baseSettings(), notifyPendingEnabled: false };
    await sendAdminNotifications(db.prisma, s);
    const updated = await db.prisma.pendingEmail.findUnique({ where: { id: pending.id } });
    expect(updated!.adminNotifiedAt).toBeNull();
  });

  it("suppresses email channel when DISABLE_EMAIL=true (test environment)", async () => {
    await seedOverdueReminder("N-020");
    process.env.DISABLE_EMAIL = "true";
    try {
      const s = { ...baseSettings(), notifyTelegramBotToken: null, notifyTelegramChatId: null };
      await sendAdminNotifications(db.prisma, s);
      expect(mockSendMail).not.toHaveBeenCalled();
    } finally {
      delete process.env.DISABLE_EMAIL;
    }
  });

  it("suppresses Telegram channel when DISABLE_TELEGRAM=true (test environment)", async () => {
    await seedOverdueReminder("N-021");
    process.env.DISABLE_TELEGRAM = "true";
    try {
      const s = { ...baseSettings(), notifyEmailAddress: null };
      await sendAdminNotifications(db.prisma, s);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.DISABLE_TELEGRAM;
    }
  });

  it("does not re-notify already-notified reminders", async () => {
    const reminder = await seedOverdueReminder("N-019");
    await db.prisma.pendingReminder.update({
      where: { id: reminder.id },
      data: { adminNotifiedAt: new Date() },
    });
    await sendAdminNotifications(db.prisma, baseSettings());
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("startNotificationScheduler", () => {
  const schedulerGlobal = globalThis as unknown as {
    notificationSchedulerStarted?: boolean;
  };

  beforeEach(async () => {
    // config reads env at import time and the started-guard lives on globalThis
    vi.resetModules();
    delete schedulerGlobal.notificationSchedulerStarted;
    delete process.env.NOTIFY_CRON_SCHEDULE;
    const cronMock = (await import("node-cron")).default;
    vi.mocked(cronMock.schedule).mockClear();
  });

  it("calls cron.schedule with the default schedule", async () => {
    const cronMock = (await import("node-cron")).default;
    const { startNotificationScheduler } = await import("@/lib/notifications");
    startNotificationScheduler();
    expect(cronMock.schedule).toHaveBeenCalledWith(
      "0 8 * * *",
      expect.any(Function)
    );
  });

  it("uses NOTIFY_CRON_SCHEDULE env override", async () => {
    process.env.NOTIFY_CRON_SCHEDULE = "0 6 * * 1";
    const cronMock = (await import("node-cron")).default;
    const { startNotificationScheduler } = await import("@/lib/notifications");
    startNotificationScheduler();
    expect(cronMock.schedule).toHaveBeenCalledWith(
      "0 6 * * 1",
      expect.any(Function)
    );
    delete process.env.NOTIFY_CRON_SCHEDULE;
  });

  it("does not register the cron job twice", async () => {
    const cronMock = (await import("node-cron")).default;
    const { startNotificationScheduler } = await import("@/lib/notifications");
    startNotificationScheduler();
    startNotificationScheduler();
    expect(cronMock.schedule).toHaveBeenCalledTimes(1);
  });
});
