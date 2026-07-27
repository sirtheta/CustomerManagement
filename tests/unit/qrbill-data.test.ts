import { describe, it, expect } from "vitest";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";

const validCompany = {
  companyName: "Test Company AG",
  companyHolderName: "John Doe",
  companyAddress: "Bahnhofstrasse 1",
  companyZip: "8000",
  companyCity: "Zürich",
  companyIBAN: "CH9300762011623852957",
  companyEmail: "info@testcompany.ch",
  companyPhone: "+41 44 123 45 67",
  useHolderNameOnQR: false,
};

const validCustomer = {
  company: "Client AG",
  contactPerson: "Test Person",
  contactInsteadOfCompany: false,
  address: "Seestrasse 100",
  zipCode: "8002",
  city: "Zürich",
};

const validInvoice = {
  documentNumber: "I-2506001",
  totalAmount: 1250.9,
};

describe("QRBill data preparation", () => {
  // Equivalent: CreateQRBill_WithValidData_ShouldGenerateCorrectBill
  it("should generate correct bill data with valid input", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: validCompany,
      customer: validCustomer,
    });

    expect(data).not.toBeNull();
    expect(data!.currency).toBe("CHF");
    expect(data!.amount).toBe(1250.9);
    expect(data!.creditor.account).toBe(validCompany.companyIBAN);
    expect(data!.creditor.name).toBe(validCompany.companyName);
    expect(data!.creditor.country).toBe("CH");

    expect(data!.debtor.name).toBe(validCustomer.company);
    expect(data!.debtor.address).toBe(validCustomer.address);
    expect(data!.debtor.zip).toBe(validCustomer.zipCode);
    expect(data!.debtor.country).toBe("CH");

    expect(data!.message).toBe(validInvoice.documentNumber);
  });

  // Equivalent: CreateQRBill_WithoutCompanyName_ShouldUseContactPerson
  it("should use contact person as debtor when company is null", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: validCompany,
      customer: { ...validCustomer, company: null },
    });
    expect(data!.debtor.name).toBe(validCustomer.contactPerson);
  });

  // Equivalent: CreateQRBill_WithContactInsteadOfCompany_ShouldUseContactPerson
  it("should use contact person as debtor when contactInsteadOfCompany is true", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: validCompany,
      customer: { ...validCustomer, contactInsteadOfCompany: true },
    });
    expect(data!.debtor.name).toBe(validCustomer.contactPerson);
  });

  it("should use holder name as creditor when useHolderNameOnQR is true", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: { ...validCompany, useHolderNameOnQR: true },
      customer: validCustomer,
    });
    expect(data!.creditor.name).toBe(validCompany.companyHolderName);
  });

  it("should return null when no IBAN is configured", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: { ...validCompany, companyIBAN: null },
      customer: validCustomer,
    });
    expect(data).toBeNull();
  });

  it("should strip spaces from IBAN", () => {
    const data = buildQrBillData({
      invoice: validInvoice,
      company: { ...validCompany, companyIBAN: "CH93 0076 2011 6238 5295 7" },
      customer: validCustomer,
    });
    expect(data!.creditor.account).toBe("CH9300762011623852957");
  });

  // Smoke test: full PDF generation must produce a non-empty buffer
  it("should produce a non-empty PDF buffer", async () => {
    const { generateInvoicePdf } = await import("@/lib/pdf/invoice-pdf");

    const buffer = await generateInvoicePdf(
      {
        id: 1,
        customerId: 1,
        documentNumber: validInvoice.documentNumber,
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        version: 1,
        state: "Draft",
        paidDate: null,
        totalAmount: 1250.9 as unknown as import("@prisma/client").Prisma.Decimal,
        customUserText: null,
        customer: {
          customerId: 1,
          company: validCustomer.company,
          contactPerson: validCustomer.contactPerson,
          address: validCustomer.address,
          zipCode: validCustomer.zipCode,
          city: validCustomer.city,
          email: "jane@clientag.ch",
          phone: null,
          yearlyInvoice: false,
          contactInsteadOfCompany: false,
          nextInvoiceDate: null,
        },
        items: [],
      },
      {
        applicationSettingsId: 1,
        numberFormat: "de-CH",
        defaultPaymentTermDays: 30,
        defaultQuoteValidityDays: 30,
        invoiceNumberPrefix: "I-",
        quoteNumberPrefix: "Q-",
        defaultYearlyInvoice: false,
        useHolderNameOnQR: false,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpFromName: null,
        emailSubjectTemplate: null,
        emailBodyTemplate: null,
        reminderCooldownDays: 14,
        notifyOverdueEnabled: false,
        notifyPendingEnabled: false,
        notifyEmailAddress: null,
        notifyTelegramBotToken: null,
        notifyTelegramChatId: null,
        notifyRepeatIntervalDays: null,
        pdfTheme: null,
        companyInformationId: 1,
        companyInfo: {
          companyInformationId: 1,
          companyName: validCompany.companyName,
          companyHolderName: validCompany.companyHolderName,
          companyAddress: validCompany.companyAddress,
          companyZip: validCompany.companyZip,
          companyCity: validCompany.companyCity,
          companyEmail: validCompany.companyEmail,
          companyPhone: validCompany.companyPhone,
          companyIBAN: validCompany.companyIBAN,
          companyLogo: null,
        },
      }
    );

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  }, 15_000);
});
