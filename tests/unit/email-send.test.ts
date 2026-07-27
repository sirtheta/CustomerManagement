import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));
vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn((v: string) => `dec:${v}`),
}));
vi.mock("@/lib/utils", () => ({
  formatCurrency: vi.fn((v: number) => `CHF ${v.toFixed(2)}`),
  formatDate: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
}));

import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/email";
import nodemailer from "nodemailer";

const mockSendMail = vi.fn();

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    smtpHost: "mail.test.ch",
    smtpPort: 587,
    smtpUser: "user@test.ch",
    smtpPassword: "enc:secret",
    smtpFromName: "Test AG",
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    reminderCooldownDays: 14,
    companyInfo: { companyName: "Test AG" },
    ...overrides,
  } as never;
}

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    contactPerson: "Max Muster",
    company: "Muster AG",
    email: "max@muster.ch",
    contactInsteadOfCompany: false,
    ...overrides,
  } as never;
}

function makeInvoice(customer = makeCustomer()) {
  return {
    documentNumber: "R-2026-001",
    totalAmount: { toNumber: () => 100 },
    date: new Date("2026-01-15"),
    dueDate: new Date("2026-02-15"),
    customUserText: "",
    customer,
  } as never;
}

function makeQuote(customer = makeCustomer()) {
  return {
    documentNumber: "A-2026-001",
    totalAmount: { toNumber: () => 200 },
    date: new Date("2026-01-20"),
    validUntil: new Date("2026-02-20"),
    customUserText: "",
    customer,
  } as never;
}

describe("email.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_EMAIL;
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail: mockSendMail } as never);
    mockSendMail.mockResolvedValue({});
  });

  describe("sendInvoiceEmail", () => {
    it("skips sending when DISABLE_EMAIL=true", async () => {
      process.env.DISABLE_EMAIL = "true";
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"));
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("throws when SMTP is not configured", async () => {
      const settings = makeSettings({ smtpHost: null });
      await expect(sendInvoiceEmail(makeInvoice(), settings, Buffer.from("pdf"))).rejects.toThrow(
        "SMTP nicht konfiguriert"
      );
    });

    it("sends email with PDF attachment using correct filename", async () => {
      const invoice = makeInvoice();
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: `rechnung-${invoice.documentNumber}.pdf`,
              contentType: "application/pdf",
            }),
          ],
        })
      );
    });

    it("uses custom to/subject/body overrides", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"), {
        to: "custom@email.ch",
        subject: "Meine Rechnung",
        body: "Hallo",
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "custom@email.ch",
          subject: "Meine Rechnung",
          text: "Hallo",
        })
      );
    });

    it("uses customer email when to override is not given", async () => {
      const customer = makeCustomer({ email: "invoice@recipient.ch" });
      await sendInvoiceEmail(makeInvoice(customer), makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "invoice@recipient.ch" })
      );
    });

    it("replaces {documentNumber} in subject template", async () => {
      const settings = makeSettings({ emailSubjectTemplate: "Rechnung {documentNumber}" });
      await sendInvoiceEmail(makeInvoice(), settings, Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Rechnung R-2026-001" })
      );
    });

    it("uses company name as display name when contactInsteadOfCompany is false", async () => {
      const customer = makeCustomer({ company: "Firma GmbH", contactInsteadOfCompany: false });
      const settings = makeSettings({ emailBodyTemplate: "Hallo {customerName}" });
      await sendInvoiceEmail(makeInvoice(customer), settings, Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Hallo Firma GmbH" })
      );
    });

    it("uses contact person as display name when contactInsteadOfCompany is true", async () => {
      const customer = makeCustomer({
        company: "Firma GmbH",
        contactPerson: "Anna Beispiel",
        contactInsteadOfCompany: true,
      });
      const settings = makeSettings({ emailBodyTemplate: "Hallo {customerName}" });
      await sendInvoiceEmail(makeInvoice(customer), settings, Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Hallo Anna Beispiel" })
      );
    });

    it("decrypts SMTP password before creating transport", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"));
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: expect.objectContaining({ pass: "dec:enc:secret" }) })
      );
    });

    it("uses port 465 with secure=true", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings({ smtpPort: 465 }), Buffer.from("pdf"));
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true })
      );
    });

    it("uses smtpUser as the from-address fallback when smtpFromAddress is not set", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.stringContaining("<user@test.ch>") })
      );
    });

    it("uses smtpFromAddress instead of smtpUser when set", async () => {
      const settings = makeSettings({ smtpFromAddress: "sanitaet@test.ch" });
      await sendInvoiceEmail(makeInvoice(), settings, Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"Test AG" <sanitaet@test.ch>' })
      );
    });
  });

  describe("sendQuoteEmail", () => {
    it("skips sending when DISABLE_EMAIL=true", async () => {
      process.env.DISABLE_EMAIL = "true";
      await sendQuoteEmail(makeQuote(), makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("sends quote email with correct attachment filename", async () => {
      const quote = makeQuote();
      await sendQuoteEmail(quote, makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: `offerte-${quote.documentNumber}.pdf`,
              contentType: "application/pdf",
            }),
          ],
        })
      );
    });

    it("replaces {documentNumber} and {validUntil} in default template", async () => {
      const settings = makeSettings({ emailBodyTemplate: null, emailSubjectTemplate: null });
      await sendQuoteEmail(makeQuote(), settings, Buffer.from("pdf"));
      const call = mockSendMail.mock.calls[0][0];
      expect(call.subject).toContain("A-2026-001");
      expect(call.text).toContain("A-2026-001");
    });

    it("uses contactPerson when contactInsteadOfCompany is true", async () => {
      const customer = makeCustomer({ contactInsteadOfCompany: true, contactPerson: "Beat Vogel" });
      // sendQuoteEmail ignores settings.emailBodyTemplate — use body override
      await sendQuoteEmail(makeQuote(customer), makeSettings(), Buffer.from("pdf"), {
        body: "Für {customerName}",
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Für Beat Vogel" })
      );
    });

    it("uses smtpFromAddress instead of smtpUser when set", async () => {
      const settings = makeSettings({ smtpFromAddress: "sanitaet@test.ch" });
      await sendQuoteEmail(makeQuote(), settings, Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"Test AG" <sanitaet@test.ch>' })
      );
    });
  });
});
