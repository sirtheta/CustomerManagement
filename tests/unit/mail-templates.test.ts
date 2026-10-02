import { describe, it, expect } from "vitest";
import {
  DEFAULT_CREDIT_NOTE_SUBJECT,
  DEFAULT_INVOICE_SUBJECT,
  defaultInvoiceBody,
  fillDocumentNumber,
  fillPlaceholders,
  fillTotalAmount,
  invoiceMail,
  invoiceMailTemplate,
  invoicePlaceholders,
  quoteMail,
  reminderMail,
} from "@/lib/mail-templates";
import { formatCurrency, formatDate } from "@/lib/utils";

const customer = { contactPerson: "Max Muster", company: "Muster AG", contactInsteadOfCompany: false };

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: "I-26090001" as string | null,
    totalAmount: { toNumber: () => 120 },
    date: new Date("2026-09-01T00:00:00Z"),
    dueDate: new Date("2026-10-01T00:00:00Z"),
    customUserText: null as string | null,
    creditNoteForId: null as number | null,
    customer,
    ...overrides,
  };
}

describe("fillPlaceholders", () => {
  it("replaces every occurrence of a known placeholder", () => {
    expect(fillPlaceholders("{companyName} / {companyName}", { companyName: "Firma" })).toBe("Firma / Firma");
  });

  it("keeps placeholders without a value and unknown words", () => {
    expect(fillPlaceholders("Nr. {documentNumber} {foo}", { documentNumber: undefined })).toBe(
      "Nr. {documentNumber} {foo}"
    );
  });

  it("inserts an empty string as a value", () => {
    expect(fillPlaceholders("a{customUserText}b", { customUserText: "" })).toBe("ab");
  });

  it("inserts values literally, without replacement patterns", () => {
    expect(fillPlaceholders("{customerName}", { customerName: "A $& B $1" })).toBe("A $& B $1");
  });

  it("fillDocumentNumber and fillTotalAmount only touch their placeholder", () => {
    expect(fillDocumentNumber("{documentNumber} {totalAmount}", "I-1")).toBe("I-1 {totalAmount}");
    expect(fillTotalAmount("{documentNumber} {totalAmount}", "CHF 1.00")).toBe("{documentNumber} CHF 1.00");
  });
});

describe("invoicePlaceholders", () => {
  it("leaves the number of a draft open and shows credit notes positive", () => {
    const values = invoicePlaceholders(
      makeInvoice({ documentNumber: null, totalAmount: { toNumber: () => -40 } }),
      "Test AG"
    );
    expect(values.documentNumber).toBeUndefined();
    expect(values.totalAmount).toBe(formatCurrency(40));
    expect(values.customerName).toBe("Muster AG");
    expect(values.customUserText).toBe("");
  });
});

describe("invoiceMailTemplate", () => {
  it("uses the settings templates, an empty one counts as unset", () => {
    expect(invoiceMailTemplate({ emailSubjectTemplate: "S {documentNumber}", emailBodyTemplate: "B" }, {
      isCreditNote: false,
      hasCustomText: false,
    })).toEqual({ subject: "S {documentNumber}", body: "B" });
    expect(
      invoiceMailTemplate({ emailSubjectTemplate: "", emailBodyTemplate: "" }, { isCreditNote: false, hasCustomText: false })
    ).toEqual({ subject: DEFAULT_INVOICE_SUBJECT, body: defaultInvoiceBody(false) });
  });

  it("ignores the settings templates for credit notes", () => {
    const tpl = invoiceMailTemplate({ emailSubjectTemplate: "S", emailBodyTemplate: "Zahlbar bis {dueDate}" }, {
      isCreditNote: true,
      hasCustomText: true,
    });
    expect(tpl.subject).toBe(DEFAULT_CREDIT_NOTE_SUBJECT);
    expect(tpl.body).not.toContain("{dueDate}");
  });

  it("gives the custom text its own paragraph only when there is one", () => {
    expect(defaultInvoiceBody(false)).not.toContain("{customUserText}");
    expect(defaultInvoiceBody(false)).not.toContain("\n\n\n");
    expect(defaultInvoiceBody(true)).toContain("{totalAmount}.\n\n{customUserText}\n\nZahlbar bis");
  });
});

describe("invoiceMail", () => {
  it("fills the default text and keeps the number of a draft", () => {
    const mail = invoiceMail(makeInvoice({ documentNumber: null, customUserText: "Danke" }), null, "Test AG");
    expect(mail.subject).toBe("Rechnung Nr. {documentNumber} – Test AG");
    expect(mail.body).toBe(
      `Guten Tag Max Muster\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom ${formatDate(
        new Date("2026-09-01T00:00:00Z")
      )} über ${formatCurrency(120)}.\n\nDanke\n\nZahlbar bis: ${formatDate(
        new Date("2026-10-01T00:00:00Z")
      )}\n\nMit freundlichen Grüssen\nTest AG`
    );
  });

  it("fills a custom template including {customerName}", () => {
    const mail = invoiceMail(
      makeInvoice(),
      { emailSubjectTemplate: "R {documentNumber}", emailBodyTemplate: "Hallo {customerName}, {contactPerson}" },
      "Test AG"
    );
    expect(mail).toEqual({ subject: "R I-26090001", body: "Hallo Muster AG, Max Muster" });
  });
});

describe("quoteMail", () => {
  it("fills the quote text without an empty custom text paragraph", () => {
    const mail = quoteMail(
      {
        documentNumber: "Q-1",
        totalAmount: { toNumber: () => 50 },
        date: new Date("2026-09-01T00:00:00Z"),
        validUntil: new Date("2026-09-30T00:00:00Z"),
        customUserText: "",
        customer: { ...customer, contactInsteadOfCompany: true },
      },
      "Test AG"
    );
    expect(mail.subject).toBe("Offerte Nr. Q-1 – Test AG");
    expect(mail.body).toContain(`über ${formatCurrency(50)}.\n\nGültig bis: ${formatDate(new Date("2026-09-30T00:00:00Z"))}`);
  });
});

describe("reminderMail", () => {
  const base = {
    level: 2,
    numberLabel: "I-1",
    contactPerson: "Max Muster",
    companyName: "Test AG",
    dueDate: new Date("2026-09-01T00:00:00Z"),
    openAmount: 100,
  };

  it("fills number, contact, amount, due date and company", () => {
    const mail = reminderMail(base);
    expect(mail.subject).toBe("1. Mahnung: Rechnung I-1 – Test AG");
    expect(mail.body).toMatch(/^Guten Tag Max Muster\n\n/);
    expect(mail.body).toContain(`Rechnung Nr.: I-1\nBetrag: ${formatCurrency(100)}\n`);
    expect(mail.body).toContain(`Fälligkeitsdatum: ${formatDate(new Date("2026-09-01T00:00:00Z"))}`);
    expect(mail.body).toMatch(/Mit freundlichen Grüssen\nTest AG$/);
    expect(mail.body).not.toMatch(/\{\w+\}/);
  });

  it("uses its own wording per level, getting firmer", () => {
    const bodies = [1, 2, 3, 4].map((level) => reminderMail({ ...base, level }).body);
    expect(new Set(bodies).size).toBe(4);
    expect(bodies[0]).toContain("gegenstandslos");
    expect(bodies[0]).not.toContain("Mahnung");
    expect(bodies[1]).toContain("trotz unserer Zahlungserinnerung");
    expect(bodies[2]).toContain("dringend");
    expect(bodies[3]).toContain("letzte Mahnung");
    expect(bodies[3]).toContain("weitere Schritte");
  });

  it("never promises debt collection, not even on the last level", () => {
    for (const level of [1, 2, 3, 4]) {
      const { subject, body } = reminderMail({ ...base, level });
      expect(`${subject}\n${body}`).not.toMatch(/Betreibung|Inkasso/i);
    }
  });

  it("titles the subject by level and marks the last one", () => {
    expect(reminderMail({ ...base, level: 1 }).subject).toBe("Zahlungserinnerung: Rechnung I-1 – Test AG");
    expect(reminderMail({ ...base, level: 4 }).subject).toBe("3. Mahnung (letzte Mahnung): Rechnung I-1 – Test AG");
    // Out-of-range levels fall back to the nearest one instead of failing.
    expect(reminderMail({ ...base, level: 9 }).subject).toBe(reminderMail({ ...base, level: 4 }).subject);
  });

  it("inserts names literally, without treating braces in them as placeholders", () => {
    const mail = reminderMail({ ...base, contactPerson: "A {companyName} $&" });
    expect(mail.body).toMatch(/^Guten Tag A \{companyName\} \$&\n/);
  });

  it("lists fee and interest only when there are any", () => {
    expect(reminderMail({ ...base, charges: { feeRappen: 0, interestRappen: 0, totalRappen: 10000 } }).body).not.toContain(
      "Mahngebühr"
    );
    const body = reminderMail({ ...base, charges: { feeRappen: 2000, interestRappen: 50, totalRappen: 12050 } }).body;
    expect(body).toContain(`Mahngebühr: ${formatCurrency(20)}`);
    expect(body).toContain(`Total: ${formatCurrency(120.5)}`);
  });
});
