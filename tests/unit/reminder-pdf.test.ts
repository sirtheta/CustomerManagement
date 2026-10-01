import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { computeReminderCharges } from "@/lib/reminder-charges";

let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let standardFontDataUrl: string;

beforeAll(async () => {
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  standardFontDataUrl =
    path
      .join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")
      .split(path.sep)
      .join("/") + "/";
});

async function extractText(buf: Buffer): Promise<{ numPages: number; pageText: string[] }> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), standardFontDataUrl }).promise;
  const pageText: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageText.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { numPages: doc.numPages, pageText };
}

const customer = {
  customerId: 1, contactInsteadOfCompany: false, company: "Muster AG", contactPerson: "Anna Beispiel",
  street: "Weg", houseNumber: "1", zipCode: "8000", city: "Zürich", country: "CH", email: "a@b.ch",
};
const invoice = {
  id: 1, documentNumber: "I-26010001", customerId: 1, date: new Date("2026-01-01"),
  dueDate: new Date("2026-01-31"), totalAmount: 1000, discountPercent: 0, customUserText: null,
  creditNoteForId: null, state: "Overdue", customer, items: [],
} as never;
const settings = {
  numberFormat: "de-CH", pdfTheme: null, useHolderNameOnQR: false, reminderCooldownDays: 14,
  reminderFeeLevel2Rappen: 1000, reminderFeeLevel3Rappen: 2000, reminderFeeLevel4Rappen: 3000,
  reminderInterestPercent: 5,
  companyInfo: {
    companyName: "Firma AG", companyHolderName: "Inhaber", companyStreet: "Bahnhofstrasse",
    companyHouseNumber: "1", companyZip: "8000", companyCity: "Zürich", companyCountry: "CH",
    companyIBAN: "CH9300762011623852957",
  },
} as never;

function charges(level: number, days = 73) {
  const due = new Date("2026-01-31T00:00:00Z");
  return computeReminderCharges({
    level, openRappen: 100000, dueDate: due,
    dunningDate: new Date(due.getTime() + days * 86_400_000),
    settings: settings as never,
  });
}

describe("generateReminderPdf", () => {
  it.each([[1, "Zahlungserinnerung"], [2, "1. Mahnung"], [3, "2. Mahnung"], [4, "3. Mahnung"]])(
    "level %i is titled %s and not Rechnung",
    async (level, title) => {
      const buf = await generateReminderPdf(invoice, settings, charges(level));
      const { pageText } = await extractText(buf);
      expect(pageText[0]).toContain(title);
      expect(pageText[0]).not.toContain("Beschreibung"); // no items table
      expect(pageText[0]).not.toContain("Menge");
      expect(pageText[0]).toContain("I-26010001");
    }
  );

  it("shows open amount, fee, interest and the total, and puts the total on the QR slip", async () => {
    const buf = await generateReminderPdf(invoice, settings, charges(2));
    const { numPages, pageText } = await extractText(buf);
    const first = pageText[0];
    expect(first).toContain("Offener Betrag");
    expect(first).toContain("Mahngebühr");
    expect(first).toContain("Verzugszins");
    expect(first).toMatch(/1['’]020\.00/);
    expect(numPages).toBe(2);
    expect(pageText[1]).toMatch(/1[\s  ]020\.00/);
  });

  it("addresses the notice to the billing address with UID and shows the QR debtor", async () => {
    const withBilling = {
      ...(invoice as object),
      customer: {
        ...customer,
        customerNumber: 1042,
        uid: "CHE-116.281.710",
        billingName: "Muster AG, Buchhaltung",
        billingStreet: "Postfach",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
      },
    } as never;
    const { pageText } = await extractText(await generateReminderPdf(withBilling, settings, charges(2)));
    expect(pageText[0]).toContain("Muster AG, Buchhaltung");
    expect(pageText[0]).toContain("3000 Bern");
    expect(pageText[0]).toContain("UID: CHE-116.281.710");
    expect(pageText[0]).toContain("Kunden-Nr.:");
    // Company header also says "8000 Zürich"; the customer's own street must be gone.
    expect(pageText[0]).not.toContain("Weg 1");
    // The QR slip (page 2) names the same debtor.
    expect(pageText[1]).toContain("Muster AG, Buchhaltung");
    expect(pageText[1]).toContain("Postfach");
  });

  it("prints no overdue note when the due date is the dunning date", async () => {
    const due = new Date("2026-01-31T00:00:00Z");
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: due, settings: settings as never });
    const { pageText } = await extractText(await generateReminderPdf(invoice, settings, c));
    expect(pageText[0]).not.toContain("überfällig");
  });

  it("omits fee and interest lines when they are zero", async () => {
    const off = { ...(settings as object), reminderFeeLevel2Rappen: 0, reminderInterestPercent: 0 } as never;
    const c = computeReminderCharges({
      level: 2, openRappen: 100000, dueDate: new Date("2026-01-31"), dunningDate: new Date("2026-03-15"), settings: off,
    });
    const { pageText } = await extractText(await generateReminderPdf(invoice, off, c));
    expect(pageText[0]).not.toContain("Mahngebühr");
    expect(pageText[0]).not.toContain("Verzugszins");
    expect(pageText[0]).toContain("Offener Betrag");
  });
});
