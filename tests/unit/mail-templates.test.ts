import { describe, it, expect } from "vitest";
import {
  DEFAULT_CREDIT_NOTE_BODY,
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
  removeEmptyTopic,
} from "@/lib/mail-templates";
import { formatCurrency, formatDate } from "@/lib/utils";

const customer = { contactPerson: "Max Muster", company: "Muster AG", contactInsteadOfCompany: false };

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: "I-26090001" as string | null,
    topic: null as string | null,
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
        topic: null,
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

  it("names the amount the open remainder after a partial payment", () => {
    const charges = { feeRappen: 0, interestRappen: 0, totalRappen: 6000, paidRappen: 4000, creditedRappen: 0 };
    const body = reminderMail({ ...base, openAmount: 60, charges }).body;
    expect(body).toContain(`Offener Restbetrag: ${formatCurrency(60)} (bereits erhaltene Zahlungen und Gutschriften abgezogen)`);
    expect(body).not.toContain("\nBetrag:");
  });
});

describe("salutation placeholder", () => {
  it("starts the default invoice mail with the chosen salutation", () => {
    const mail = invoiceMail(
      {
        documentNumber: "I-1",
        topic: null,
        totalAmount: { toNumber: () => 10 },
        date: new Date("2026-01-01"),
        dueDate: new Date("2026-01-31"),
        customUserText: null,
        creditNoteForId: null,
        customer: { ...customer, title: "Frau", salutationKind: "formal" },
      },
      null,
      "Firma"
    );
    expect(mail.body).toMatch(/^Sehr geehrte Frau Muster\n\n/);
  });

  it("starts a reminder with the given salutation", () => {
    const mail = reminderMail({
      level: 1,
      numberLabel: "I-1",
      contactPerson: "Max Muster",
      salutation: "Sehr geehrte Damen und Herren",
      companyName: "Firma",
      dueDate: new Date("2026-01-31"),
      openAmount: 10,
    });
    expect(mail.body).toMatch(/^Sehr geehrte Damen und Herren\n\n/);
  });
});

describe("topic placeholder", () => {
  it("names the topic in the default invoice mail", () => {
    const mail = invoiceMail(makeInvoice({ topic: "Hosting 2027" }), null, "Test AG");
    expect(mail.subject).toBe("Rechnung Nr. I-26090001 – Hosting 2027 – Test AG");
    expect(mail.body).toContain("die Rechnung Nr. I-26090001 für «Hosting 2027» vom ");
  });

  it("leaves the default texts unchanged without a topic", () => {
    const mail = invoiceMail(makeInvoice(), null, "Test AG");
    expect(mail.subject).toBe("Rechnung Nr. I-26090001 – Test AG");
    expect(mail.body).toContain("die Rechnung Nr. I-26090001 vom ");
    expect(invoiceMailTemplate(null, { isCreditNote: true, hasCustomText: false }).body).toBe(DEFAULT_CREDIT_NOTE_BODY);
  });

  it("names the topic in credit note and quote mails", () => {
    const credit = invoiceMail(makeInvoice({ topic: "Domain", creditNoteForId: 1 }), null, "Test AG");
    expect(credit.subject).toBe("Gutschrift Nr. I-26090001 – Domain – Test AG");
    expect(credit.body).toContain("die Gutschrift Nr. I-26090001 für «Domain» vom ");

    const quote = quoteMail(
      {
        documentNumber: "Q-1",
        topic: "Office-Installation",
        totalAmount: { toNumber: () => 50 },
        date: new Date("2026-09-01T00:00:00Z"),
        validUntil: new Date("2026-09-30T00:00:00Z"),
        customUserText: null,
        customer,
      },
      "Test AG"
    );
    expect(quote.subject).toBe("Offerte Nr. Q-1 – Office-Installation – Test AG");
    expect(quote.body).toContain("die Offerte Nr. Q-1 für «Office-Installation» vom ");
  });

  it("fills {topic} in a custom template", () => {
    const mail = invoiceMail(
      makeInvoice({ topic: "Hosting" }),
      { emailSubjectTemplate: "{topic}: Rechnung {documentNumber}", emailBodyTemplate: "Betreff: {topic}\nText" },
      "Test AG"
    );
    expect(mail).toEqual({ subject: "Hosting: Rechnung I-26090001", body: "Betreff: Hosting\nText" });
  });

  it("removes an empty topic with its separator from a custom template", () => {
    const mail = invoiceMail(
      makeInvoice(),
      {
        emailSubjectTemplate: "Rechnung {documentNumber} – {topic} – {companyName}",
        emailBodyTemplate: "Hallo\nBetreff: {topic}\nRechnung «{topic}» {documentNumber}",
      },
      "Test AG"
    );
    expect(mail).toEqual({ subject: "Rechnung I-26090001 – Test AG", body: "Hallo\nRechnung I-26090001" });
  });

  it("removeEmptyTopic handles leading, trailing and bare placeholders", () => {
    expect(removeEmptyTopic("{topic} – Rechnung {documentNumber}")).toBe("Rechnung {documentNumber}");
    expect(removeEmptyTopic("Rechnung {documentNumber}: {topic}")).toBe("Rechnung {documentNumber}");
    expect(removeEmptyTopic("Rechnung ({topic}) {documentNumber}")).toBe("Rechnung {documentNumber}");
    expect(removeEmptyTopic("A\n{topic}\nB")).toBe("A\nB");
    expect(removeEmptyTopic("für {topic} danke")).toBe("für danke");
    // A subject line never loses its label: the line rule only applies to lines followed by another one.
    expect(removeEmptyTopic("Betreff: {topic}")).toBe("Betreff");
  });

  it("keeps {topic} while its value is unknown", () => {
    expect(fillPlaceholders("R – {topic}", { topic: undefined })).toBe("R – {topic}");
  });

  it("adds a subject line to the reminder mail only with a topic", () => {
    const base = {
      level: 1,
      numberLabel: "I-1",
      contactPerson: "Max Muster",
      companyName: "Firma",
      dueDate: new Date("2026-01-31"),
      openAmount: 10,
    };
    expect(reminderMail({ ...base, topic: "Hosting 2027" }).body).toContain("Rechnung Nr.: I-1\nBetreff: Hosting 2027\nBetrag:");
    expect(reminderMail(base).body).toContain("Rechnung Nr.: I-1\nBetrag:");
  });
});
