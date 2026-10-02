import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { generateDocumentPdf, type RenderDoc, type RenderItem } from "@/lib/pdf/document-pdf";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateInvoicePdf, generateQuotePdf } from "@/lib/pdf/invoice-pdf";

// Real byte-level assertions on pdfkit's output (page count, embedded text,
// the Swiss QR bill page) — the existing pdf-fonts.test.ts only checks
// buf.length > 0, so none of this was actually exercised (review finding #13).
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

const company = { companyName: "Firma AG", companyHolderName: "Inhaber" };

function baseDoc(overrides: Partial<RenderDoc> = {}): RenderDoc {
  return {
    kind: "invoice",
    title: "Rechnung",
    documentNumber: "I-26010001",
    numberLabel: "Rechnungs-Nr.:",
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-01-31"),
    dueLabel: "Fälligkeit:",
    closingNoteLabel: "Zahlbar bis:",
    customUserText: null,
    totalAmount: 100,
    customer: {
      contactInsteadOfCompany: false,
      company: "Muster AG",
      contactPerson: "Anna Beispiel",
      street: "Weg",
        houseNumber: "1",
        country: "CH",
      zipCode: "8000",
      city: "Zürich",
    },
    items: [
      { name: "Pos 1", description: null, unit: "Hour", quantity: 1, unitPrice: 100, totalAmount: 100 },
    ],
    qr: null,
    draft: false,
    ...overrides,
  };
}

describe("generateDocumentPdf byte assembly", () => {
  it("produces a well-formed PDF starting with the %PDF- header", async () => {
    const buf = await generateDocumentPdf(baseDoc(), company, "de-CH", undefined);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("embeds the document title, number and total in the extracted text", async () => {
    const buf = await generateDocumentPdf(baseDoc(), company, "de-CH", undefined);
    const { numPages, pageText } = await extractText(buf);
    expect(numPages).toBe(1);
    expect(pageText[0]).toContain("Rechnung");
    expect(pageText[0]).toContain("I-26010001");
    expect(pageText[0]).toContain("100.00");
  });

  it("renders a credit note without due date and without a QR bill page", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({
        title: "Gutschrift",
        numberLabel: "Gutschrift-Nr.:",
        documentNumber: "I-26010002",
        referenceLine: "Zu Rechnung I-26010001",
        dueDate: null,
        totalAmount: -180,
        qr: null,
      }),
      company,
      "de-CH",
      undefined
    );
    const { numPages, pageText } = await extractText(buf);
    const text = pageText.join(" ");
    expect(numPages).toBe(1);
    expect(text).toContain("Gutschrift");
    expect(text).toContain("Zu Rechnung I-26010001");
    expect(text).not.toContain("Fälligkeit");
    expect(text).not.toContain("Zahlbar bis");
  });

  it("adds no QR page for a quote (qr: null)", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({ kind: "quote", title: "Offerte", qr: null }),
      company,
      "de-CH",
      undefined
    );
    const { numPages } = await extractText(buf);
    expect(numPages).toBe(1);
  });

  const extended = {
    contactInsteadOfCompany: false,
    company: "Muster AG",
    contactPerson: "Anna Beispiel",
    street: "Hauptstrasse",
    houseNumber: "5",
    zipCode: "8001",
    city: "Zürich",
    country: "CH",
    customerNumber: 1042,
    uid: "CHE-116.281.710",
    billingName: "Muster AG, Buchhaltung",
    billingStreet: "Postfach",
    billingZipCode: "3000",
    billingCity: "Bern",
    billingCountry: "CH",
  };

  it("addresses an invoice to the billing address with UID and customer number", async () => {
    const buf = await generateDocumentPdf(baseDoc({ customer: extended }), company, "de-CH", undefined);
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).toContain("Muster AG, Buchhaltung");
    expect(text).toContain("Postfach");
    expect(text).toContain("3000 Bern");
    expect(text).toContain("UID: CHE-116.281.710");
    expect(text).toContain("Kunden-Nr.:");
    expect(text).toContain("1042");
    expect(text).not.toContain("Hauptstrasse");
  });

  it("addresses a quote to the customer address without UID but with customer number", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({ kind: "quote", title: "Offerte", customer: extended }),
      company,
      "de-CH",
      undefined
    );
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).toContain("Hauptstrasse 5");
    expect(text).toContain("8001 Zürich");
    expect(text).not.toContain("Postfach");
    expect(text).not.toContain("UID:");
    expect(text).toContain("1042");
  });

  it("omits Kunden-Nr. and UID for customers without them", async () => {
    const buf = await generateDocumentPdf(baseDoc(), company, "de-CH", undefined);
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).not.toContain("Kunden-Nr.");
    expect(text).not.toContain("UID:");
  });

  it("appends a separate Swiss QR bill page when qr data is present", async () => {
    const qr = buildQrBillData({
      invoice: { documentNumber: "I-26010001", totalAmount: 100 },
      company: {
        companyName: "Firma AG",
        companyHolderName: "Inhaber",
        companyStreet: "Bahnhofstrasse", companyHouseNumber: "1",
        companyZip: "8000",
        companyCity: "Zürich",
        companyIBAN: "CH9300762011623852957",
        useHolderNameOnQR: false,
      },
      customer: {
        company: "Muster AG",
        contactPerson: "Anna Beispiel",
        contactInsteadOfCompany: false,
        street: "Weg",
        houseNumber: "1",
        country: "CH",
        zipCode: "8000",
        city: "Zürich",
      },
    });
    expect(qr).not.toBeNull();

    const buf = await generateDocumentPdf(baseDoc({ qr }), company, "de-CH", undefined);
    const { numPages, pageText } = await extractText(buf);

    expect(numPages).toBe(2);
    // swissqrbill renders the German payment-slip headings on the appended page.
    expect(pageText[1]).toContain("Zahlteil");
    expect(pageText[1]).toContain("Empfangsschein");
  });

  it("breaks the items table onto a new page once it overflows the first", async () => {
    const items: RenderItem[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Position ${i + 1}`,
      description: "Eine etwas längere Beschreibung, die Platz braucht.",
      unit: "Hour" as const,
      quantity: 1,
      unitPrice: 10,
      totalAmount: 10,
    }));
    const buf = await generateDocumentPdf(
      baseDoc({ items, totalAmount: 400 }),
      company,
      "de-CH",
      undefined
    );
    const { numPages } = await extractText(buf);
    expect(numPages).toBeGreaterThan(1);
  });

  it("renders the discount lines when discountPercent is set", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({ discountPercent: 10, totalAmount: 90 }),
      company,
      "de-CH",
      undefined
    );
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Rabatt");
    expect(pageText[0]).toContain("Zwischensumme");
    expect(pageText[0]).not.toContain("Rundung");
  });

  it("shows the discount and the rounding on separate lines", async () => {
    // 99.99 - 12.5 % = 87.49 (discount 12.50), rounded to 87.50 (rounding 0.01)
    const buf = await generateDocumentPdf(
      baseDoc({
        discountPercent: 12.5,
        totalAmount: 87.5,
        items: [{ name: "Pos 1", description: null, unit: "Hour", quantity: 1, unitPrice: 99.99, totalAmount: 99.99 }],
      }),
      company,
      "de-CH",
      undefined
    );
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Rabatt (12.5");
    expect(pageText[0]).toContain("- CHF 12.50");
    expect(pageText[0]).toContain("Rundung");
    expect(pageText[0]).toContain("CHF 0.01");
    expect(pageText[0]).toContain("CHF 87.50");
  });

  it("shows a rounding line without discount and marks a downward rounding", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({
        totalAmount: 100,
        items: [{ name: "Pos 1", description: null, unit: "Hour", quantity: 1, unitPrice: 100.02, totalAmount: 100.02 }],
      }),
      company,
      "de-CH",
      undefined
    );
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Zwischensumme");
    expect(pageText[0]).not.toContain("Rabatt");
    expect(pageText[0]).toContain("Rundung");
    expect(pageText[0]).toContain("- CHF 0.02");
  });

  it("prints a credit note's discount without a double minus and no phantom rounding", async () => {
    // Invoice 100.05 - 10 % = 90.05; the credit note stores the mirrored amounts.
    const buf = await generateDocumentPdf(
      baseDoc({
        discountPercent: 10,
        totalAmount: -90.05,
        items: [{ name: "Pos 1", description: null, unit: "Hour", quantity: -1, unitPrice: 100.05, totalAmount: -100.05 }],
      }),
      company,
      "de-CH",
      undefined
    );
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Rabatt (10");
    expect(pageText[0]).toContain("- CHF 10.00");
    expect(pageText[0]).not.toContain("CHF -10.0");
    expect(pageText[0]).not.toContain("Rundung");
  });
});

describe("draft watermark", () => {
  it("draws no ENTWURF watermark on a numbered document", async () => {
    const buf = await generateDocumentPdf(baseDoc(), company, "de-CH", undefined);
    const { pageText } = await extractText(buf);
    expect(pageText[0]).not.toContain("ENTWURF");
  });

  it("draws the ENTWURF watermark without adding pages", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({ draft: true, documentNumber: "Entwurf" }),
      company,
      "de-CH",
      undefined
    );
    const { numPages, pageText } = await extractText(buf);
    expect(numPages).toBe(1);
    expect(pageText[0]).toContain("ENTWURF");
  });

  it("repeats the watermark on every page of a multi-page draft", async () => {
    const items: RenderItem[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Position ${i + 1}`,
      description: "Eine etwas längere Beschreibung, die Platz braucht.",
      unit: "Hour" as const,
      quantity: 1,
      unitPrice: 10,
      totalAmount: 10,
    }));
    const buf = await generateDocumentPdf(
      baseDoc({ draft: true, documentNumber: "Entwurf", items, totalAmount: 400 }),
      company,
      "de-CH",
      undefined
    );
    const { numPages, pageText } = await extractText(buf);
    expect(numPages).toBeGreaterThan(1);
    for (const t of pageText) expect(t).toContain("ENTWURF");
  });
});

describe("generateInvoicePdf drafts", () => {
  const decimal = (n: number) => n as unknown as import("@prisma/client").Prisma.Decimal;
  const invoiceFor = (documentNumber: string | null, overrides: Record<string, unknown> = {}) =>
    ({
      id: 5,
      customerId: 1,
      documentNumber,
      date: new Date("2026-01-01"),
      dueDate: new Date("2026-01-31"),
      version: 1,
      state: "Draft",
      totalAmount: decimal(100),
      discountPercent: decimal(0),
      customUserText: null,
      customer: {
        customerId: 1,
        company: "Muster AG",
        contactPerson: "Anna Beispiel",
        street: "Weg",
        houseNumber: "1",
        country: "CH",
        zipCode: "8000",
        city: "Zürich",
        contactInsteadOfCompany: false,
      },
      items: [
        {
          id: 1,
          name: "Pos 1",
          description: null,
          unit: "Hour",
          unitPrice: decimal(100),
          quantity: decimal(1),
          discountPercent: decimal(0),
          totalAmount: decimal(100),
        },
      ],
      ...overrides,
    }) as never;
  const settings = {
    companyInfo: {
      companyName: "Firma AG",
      companyHolderName: "Inhaber",
      companyStreet: "Bahnhofstrasse",
      companyHouseNumber: "1",
      companyZip: "8000",
      companyCity: "Zürich",
      companyIBAN: "CH9300762011623852957",
    },
    numberFormat: "de-CH",
    pdfTheme: null,
    useHolderNameOnQR: false,
  } as never;

  it("renders an unnumbered invoice as watermarked draft without QR page", async () => {
    const buf = await generateInvoicePdf(invoiceFor(null), settings);
    const { numPages, pageText } = await extractText(buf);
    expect(numPages).toBe(1);
    expect(pageText[0]).toContain("ENTWURF");
    expect(pageText[0]).toContain("Entwurf");
    expect(pageText[0]).not.toContain("Zahlteil");
  });

  it("renders a numbered invoice with QR page and no watermark", async () => {
    const buf = await generateInvoicePdf(invoiceFor("I-26010001"), settings);
    const { numPages, pageText } = await extractText(buf);
    expect(numPages).toBe(2);
    expect(pageText[0]).not.toContain("ENTWURF");
    expect(pageText[1]).toContain("Zahlteil");
  });

  it("prints the stored total and a Rundung line when it differs from the items", async () => {
    // items add up to 100.00, the stored (5-Rappen rounded) total is 100.05
    const buf = await generateInvoicePdf(invoiceFor(null, { totalAmount: decimal(100.05) }), settings);
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Rundung");
    expect(pageText[0]).toContain("100.05");
  });

  it("prints no Rundung line when the total matches the items", async () => {
    const buf = await generateInvoicePdf(invoiceFor(null), settings);
    const { pageText } = await extractText(buf);
    expect(pageText[0]).not.toContain("Rundung");
    expect(pageText[0]).not.toContain("Zwischensumme");
  });
});

describe("generateQuotePdf", () => {
  it("renders the document-level discount stored on the quote", async () => {
    const decimal = (n: number) => n as unknown as import("@prisma/client").Prisma.Decimal;
    const buf = await generateQuotePdf(
      {
        id: 1,
        customerId: 1,
        documentNumber: "O-26010001",
        date: new Date("2026-01-01"),
        validUntil: new Date("2026-01-31"),
        version: 1,
        state: "Draft",
        totalAmount: decimal(90),
        discountPercent: decimal(10),
        customUserText: null,
        customer: {
          customerId: 1,
          company: "Muster AG",
          contactPerson: "Anna Beispiel",
          street: "Weg",
        houseNumber: "1",
        country: "CH",
        addressNeedsReview: false,
          zipCode: "8000",
          city: "Zürich",
          email: "anna@muster.ch",
          phone: null,
          contactInsteadOfCompany: false,
          archivedAt: null,
          customerNumber: null,
          uid: null,
          billingName: null,
          billingStreet: null,
          billingHouseNumber: null,
          billingZipCode: null,
          billingCity: null,
          billingCountry: null,
          billingEmail: null,
          paymentTermDays: null,
        },
        items: [
          {
            id: 1,
            invoiceId: null,
            quoteId: 1,
            name: "Pos 1",
            description: null,
            unit: "Hour",
            unitPrice: decimal(100),
            quantity: decimal(1),
            discountPercent: decimal(0),
            totalAmount: decimal(100),
            customText: null,
            categoryId: null,
          },
        ],
      },
      {
        companyInfo: { companyName: "Firma AG", companyHolderName: "Inhaber" },
        numberFormat: "de-CH",
        pdfTheme: null,
      } as never
    );
    const { pageText } = await extractText(buf);
    expect(pageText[0]).toContain("Zwischensumme");
    expect(pageText[0]).toContain("Rabatt (10");
  });
});
