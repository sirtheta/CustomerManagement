import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import {
  generateDocumentPdf,
  type CompanyInfoForPdf,
  type RenderDoc,
} from "@/lib/pdf/document-pdf";
import { NextRequest } from "next/server";

// Constant sample data so the live preview renders without touching real documents.
const SAMPLE_CUSTOMER = {
  contactInsteadOfCompany: false,
  company: "Muster AG",
  contactPerson: "Anna Beispiel",
  address: "Musterstrasse 12",
  zipCode: "8000",
  city: "Zürich",
};

const SAMPLE_ITEMS = [
  { name: "Beratung", description: "Konzept und Planung", unit: "Hour", quantity: 8, unitPrice: 140, totalAmount: 1120 },
  { name: "Umsetzung", description: "Entwicklung der Lösung", unit: "Day", quantity: 3, unitPrice: 980, totalAmount: 2940 },
  { name: "Material", description: null, unit: "Piece", quantity: 5, unitPrice: 24.5, totalAmount: 122.5 },
] as const;

const SAMPLE_TOTAL = 4182.5;

const FALLBACK_COMPANY: CompanyInfoForPdf = {
  companyName: "Meine Firma GmbH",
  companyHolderName: "Max Mustermann",
  companyAddress: "Beispielweg 1",
  companyZip: "3000",
  companyCity: "Bern",
  companyEmail: "kontakt@meinefirma.ch",
  companyPhone: "031 123 45 67",
  companyLogo: null,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, [UserRole.Admin])) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    type?: "invoice" | "quote";
    theme?: unknown;
  };
  const type = body.type === "quote" ? "quote" : "invoice";

  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  const company: CompanyInfoForPdf = settings?.companyInfo ?? FALLBACK_COMPANY;
  const locale = settings?.numberFormat ?? "de-CH";

  const now = new Date();
  const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const qr =
    type === "invoice"
      ? buildQrBillData({
          invoice: { documentNumber: "I-PREVIEW", totalAmount: SAMPLE_TOTAL },
          company: { ...company, useHolderNameOnQR: settings?.useHolderNameOnQR ?? false },
          customer: SAMPLE_CUSTOMER,
        })
      : null;

  const doc: RenderDoc = {
    kind: type,
    title: type === "invoice" ? "Rechnung" : "Offerte",
    documentNumber: type === "invoice" ? "I-PREVIEW" : "Q-PREVIEW",
    numberLabel: type === "invoice" ? "Rechnungs-Nr.:" : "Offerten-Nr.:",
    date: now,
    dueDate: due,
    dueLabel: type === "invoice" ? "Fälligkeit:" : "Gültig bis:",
    closingNoteLabel: type === "invoice" ? "Zahlbar bis:" : "Gültig bis:",
    customUserText: "Vielen Dank für Ihren Auftrag.",
    totalAmount: SAMPLE_TOTAL,
    customer: SAMPLE_CUSTOMER,
    items: SAMPLE_ITEMS.map((i) => ({ ...i })),
    qr,
  };

  const pdf = await generateDocumentPdf(doc, company, locale, body.theme);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="vorschau.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
