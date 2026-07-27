import { describe, it, expect } from "vitest";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";

const doc: RenderDoc = {
  kind: "invoice",
  title: "Rechnung",
  documentNumber: "I-TEST",
  numberLabel: "Rechnungs-Nr.:",
  date: new Date("2026-01-01"),
  dueDate: new Date("2026-01-31"),
  dueLabel: "Fälligkeit:",
  closingNoteLabel: "Zahlbar bis:",
  customUserText: "Test",
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
    { name: "Pos", description: null, unit: "Hour", quantity: 1, unitPrice: 100, totalAmount: 100 },
  ],
  qr: null,
};

const company = { companyName: "Firma", companyHolderName: "Inhaber" };

describe("generateDocumentPdf fonts", () => {
  it("renders with a built-in font", async () => {
    const buf = await generateDocumentPdf(doc, company, "de-CH", { fontFamily: "Helvetica" });
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders with an embedded .woff font (Lato)", async () => {
    const buf = await generateDocumentPdf(doc, company, "de-CH", { fontFamily: "Lato" });
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders with an embedded serif font (Lora)", async () => {
    const buf = await generateDocumentPdf(doc, company, "de-CH", { fontFamily: "Lora" });
    expect(buf.length).toBeGreaterThan(0);
  });
});
