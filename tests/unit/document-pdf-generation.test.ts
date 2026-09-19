import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { generateDocumentPdf, type RenderDoc, type RenderItem } from "@/lib/pdf/document-pdf";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";

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
      address: "Weg 1",
      zipCode: "8000",
      city: "Zürich",
    },
    items: [
      { name: "Pos 1", description: null, unit: "Hour", quantity: 1, unitPrice: 100, totalAmount: 100 },
    ],
    qr: null,
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

  it("appends a separate Swiss QR bill page when qr data is present", async () => {
    const qr = buildQrBillData({
      invoice: { documentNumber: "I-26010001", totalAmount: 100 },
      company: {
        companyName: "Firma AG",
        companyHolderName: "Inhaber",
        companyAddress: "Bahnhofstrasse 1",
        companyZip: "8000",
        companyCity: "Zürich",
        companyIBAN: "CH9300762011623852957",
        useHolderNameOnQR: false,
      },
      customer: {
        company: "Muster AG",
        contactPerson: "Anna Beispiel",
        contactInsteadOfCompany: false,
        address: "Weg 1",
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
  });
});
