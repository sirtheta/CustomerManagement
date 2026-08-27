import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import sharp from "sharp";
import type { QrBillData } from "@/lib/pdf/qrbill-helpers";
import { detectImageMime } from "@/lib/file-validation";
import logger from "@/lib/logger";
import { DEFAULT_THEME, resolveTheme, type PdfTheme } from "@/lib/pdf/theme";
import { applyFonts } from "@/lib/pdf/fonts";
import { Prisma } from "@prisma/client";
import type { Customer, Unit } from "@prisma/client";

const log = logger.child({ module: "pdf" });

// ── Fixed page geometry (A4) ──────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const TEXT_COLOR = "#000000";

const UNIT_LABELS: Record<Unit, string> = {
  Hour: "Std.",
  Day: "Tag",
  Piece: "Stk.",
  Package: "Pausch.",
};

// Document-type-agnostic shape consumed by the renderer. Invoice/quote wrappers
// map their models onto this and supply the type-specific labels + optional QR.
export type RenderDoc = {
  kind: "invoice" | "quote";
  title: string; // "Rechnung" | "Offerte"
  documentNumber: string;
  numberLabel: string; // "Rechnungs-Nr.:" | "Offerten-Nr.:"
  date: Date | string;
  dueDate: Date | string; // dueDate for invoices, validUntil for quotes
  dueLabel: string; // "Fälligkeit:" | "Gültig bis:"
  closingNoteLabel: string; // "Zahlbar bis:" | "Gültig bis:"
  customUserText: string | null;
  discountPercent?: Numeric;
  totalAmount: number;
  customer: Pick<
    Customer,
    "contactInsteadOfCompany" | "company" | "contactPerson" | "address" | "zipCode" | "city"
  >;
  items: RenderItem[];
  /** Prebuilt Swiss QR bill data; null skips the QR page (always null for quotes). */
  qr: QrBillData | null;
};

// Accepts both Prisma Decimal (real documents) and plain numbers (preview samples).
type Numeric = number | Prisma.Decimal;

export type RenderItem = {
  name: string;
  description: string | null;
  unit: Unit;
  quantity: Numeric;
  unitPrice: Numeric;
  totalAmount: Numeric;
  discountPercent?: Numeric;
};

export type CompanyInfoForPdf = {
  companyName?: string | null;
  companyHolderName?: string | null;
  companyAddress?: string | null;
  companyZip?: string | null;
  companyCity?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  companyLogo?: Uint8Array | Buffer | null;
};

function fmt(n: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: Date | string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(d));
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * Render an invoice or quote PDF. `theme` is the resolved styling layer; pass
 * DEFAULT_THEME for the legacy look. The Swiss QR bill (doc.qr) is never themed.
 */
export async function generateDocumentPdf(
  doc: RenderDoc,
  company: CompanyInfoForPdf,
  locale: string,
  rawTheme: unknown
): Promise<Buffer> {
  const theme: PdfTheme = resolveTheme(rawTheme);

  // Derived metrics
  const MARGIN = theme.margin;
  const LINE_MARGIN = Math.max(0, MARGIN - 5);
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const BASE = theme.baseFontSize;
  const SMALL = BASE - 1;
  const TITLE = BASE + 8;
  const TOTAL = BASE + 1;
  const LINE_HEIGHT = BASE + 2;
  const TABLE_ROW_H = BASE * 2;
  const ACCENT = theme.accentColor;
  const COL_W = {
    desc: CONTENT_W - 300,
    qty: 65,
    unit: 55,
    price: 90,
    total: 90,
  };

  // Pre-convert logo to PNG/JPEG before entering the sync PDFDocument callback.
  // pdfkit only supports PNG and JPEG; sharp handles BMP, TIFF, WebP, etc.
  let logoBuffer: Buffer | null = null;
  if (company.companyLogo) {
    try {
      const raw = Buffer.from(company.companyLogo);
      logoBuffer = detectImageMime(raw) ? raw : await sharp(raw).png().toBuffer();
    } catch (e) {
      log.error({ documentNumber: doc.documentNumber, err: e }, "logo conversion failed");
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      autoFirstPage: true,
      info: {
        Title: `${doc.title} ${doc.documentNumber}`,
        Author: company.companyName ?? "",
      },
    });

    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    // Register the selected font family (embedded fonts attach to this doc).
    const { regular: FONT, bold: BOLD } = applyFonts(pdf, theme.fontFamily);

    // Draw a horizontal rule in the accent color.
    const rule = (y: number, width = 0.5) => {
      pdf.moveTo(LINE_MARGIN, y).lineTo(PAGE_W - LINE_MARGIN, y).lineWidth(width).stroke(ACCENT);
    };

    const customer = doc.customer;
    let y = MARGIN;

    // ── Logo ────────────────────────────────────────────────────────────
    if (logoBuffer) {
      const lx =
        theme.logoPosition === "right" ? PAGE_W - MARGIN - theme.logoMaxSize : MARGIN;
      pdf.image(logoBuffer, lx, y, { fit: [theme.logoMaxSize, theme.logoMaxSize] });
    }

    // ── Company info ─────────────────────────────────────────────────────
    // Aligns opposite the logo so the two never collide.
    const companyAlign = theme.logoPosition === "right" ? "left" : "right";
    const companyLines = [
      company.companyName,
      company.companyHolderName,
      company.companyAddress,
      `${company.companyZip ?? ""} ${company.companyCity ?? ""}`.trim(),
      null,
      theme.showPhone && company.companyPhone ? `Tel. ${company.companyPhone}` : null,
      theme.showEmail ? company.companyEmail : null,
    ].filter(Boolean) as string[];

    pdf.font(FONT).fontSize(SMALL).fillColor(TEXT_COLOR);
    companyLines.forEach((line, i) => {
      pdf.text(line, MARGIN, y + i * LINE_HEIGHT, { width: CONTENT_W, align: companyAlign });
    });
    y += Math.max(theme.logoMaxSize + 15, companyLines.length * LINE_HEIGHT + 15);

    // ── Customer address ─────────────────────────────────────────────────
    const displayName =
      customer.contactInsteadOfCompany || !customer.company
        ? customer.contactPerson
        : customer.company;
    const addrLines = [
      displayName,
      !customer.contactInsteadOfCompany && customer.company ? customer.contactPerson : null,
      customer.address,
      `${customer.zipCode} ${customer.city}`,
    ].filter(Boolean) as string[];

    pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
    addrLines.forEach((line, i) => {
      pdf.text(line, MARGIN, y + i * LINE_HEIGHT);
    });
    y += addrLines.length * LINE_HEIGHT + 50;

    // ── Title ────────────────────────────────────────────────────────────
    pdf.font(BOLD).fontSize(TITLE).fillColor(ACCENT);
    pdf.text(doc.title, MARGIN, y);
    y += TITLE + 10;

    pdf.fontSize(BASE).fillColor(TEXT_COLOR);
    const detailRows = [
      [doc.numberLabel, doc.documentNumber],
      ["Datum:", fmtDate(doc.date, locale)],
      [doc.dueLabel, fmtDate(doc.dueDate, locale)],
    ];
    detailRows.forEach(([label, value]) => {
      pdf.font(BOLD).text(label, MARGIN, y);
      pdf.font(FONT).text(value, MARGIN + 90, y);
      y += LINE_HEIGHT + 2;
    });
    y += 12;

    // ── Custom user text ─────────────────────────────────────────────────
    if (doc.customUserText) {
      pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
      const text = clean(doc.customUserText);
      const textH = pdf.heightOfString(text, { width: CONTENT_W });
      pdf.text(text, MARGIN, y, { width: CONTENT_W });
      y += textH + 16;
    }

    // ── Items table header ───────────────────────────────────────────────
    let headerTextColor = ACCENT;
    if (theme.tableHeaderFill) {
      pdf.rect(LINE_MARGIN, y, PAGE_W - 2 * LINE_MARGIN, TABLE_ROW_H + 6).fill(ACCENT);
      headerTextColor = "#ffffff";
      y += 6;
    } else {
      rule(y, 0.5);
      y += 6;
    }

    pdf.font(BOLD).fontSize(SMALL).fillColor(headerTextColor);
    let x = MARGIN;
    pdf.text("Beschreibung", x, y, { width: COL_W.desc });
    x += COL_W.desc;
    pdf.text("Menge", x, y, { width: COL_W.qty, align: "right" });
    x += COL_W.qty;
    pdf.text("Einheit", x, y, { width: COL_W.unit, align: "right" });
    x += COL_W.unit;
    pdf.text("Preis/Einheit", x, y, { width: COL_W.price, align: "right" });
    x += COL_W.price;
    pdf.text("Total", x, y, { width: COL_W.total, align: "right" });
    y += TABLE_ROW_H;
    if (theme.tableHeaderFill) {
      y += 8;
    } else {
      rule(y, 0.5);
      y += 8;
    }

    // ── Items rows ───────────────────────────────────────────────────────
    pdf.fillColor(TEXT_COLOR);
    for (const item of doc.items) {
      // Reserve ~60pt for the totals block below the table
      if (y > PAGE_H - MARGIN - 60) {
        pdf.addPage();
        y = MARGIN;
      }

      const nameH = pdf
        .font(BOLD)
        .fontSize(BASE)
        .heightOfString(item.name, { width: COL_W.desc });
      const descH = item.description
        ? pdf.font(FONT).fontSize(SMALL).heightOfString(item.description, { width: COL_W.desc })
        : 0;
      const discountH = Number(item.discountPercent ?? 0) > 0 ? LINE_HEIGHT : 0;
      const rowH = Math.max(TABLE_ROW_H, nameH + descH + discountH + 4);

      x = MARGIN;
      pdf.font(BOLD).fontSize(BASE).fillColor(TEXT_COLOR);
      pdf.text(item.name, x, y, { width: COL_W.desc });
      if (item.description) {
        pdf.font(FONT).fontSize(SMALL);
        pdf.text(item.description, x, y + nameH + 2, { width: COL_W.desc });
      }
      if (Number(item.discountPercent ?? 0) > 0) {
        pdf.font(FONT).fontSize(SMALL).fillColor(TEXT_COLOR);
        pdf.text(`Rabatt: ${fmt(Number(item.discountPercent), locale)} %`, x, y + nameH + descH + 4, {
          width: COL_W.desc,
        });
      }

      x += COL_W.desc;
      pdf.font(FONT).fontSize(BASE);
      pdf.text(fmt(Number(item.quantity), locale), x, y, { width: COL_W.qty, align: "right" });
      x += COL_W.qty;
      pdf.text(UNIT_LABELS[item.unit], x, y, { width: COL_W.unit, align: "right" });
      x += COL_W.unit;
      pdf.text(`CHF ${fmt(Number(item.unitPrice), locale)}`, x, y, {
        width: COL_W.price,
        align: "right",
      });
      x += COL_W.price;
      pdf.text(`CHF ${fmt(Number(item.totalAmount), locale)}`, x, y, {
        width: COL_W.total,
        align: "right",
      });

      y += rowH + 10;
    }

    // ── Totals ───────────────────────────────────────────────────────────
    y += 5;
    rule(y, 0.5);
    y += 8;

    const subtotal = doc.items.reduce((sum, item) => sum + Number(item.totalAmount), 0);
    const invoiceDiscount = Number(doc.discountPercent ?? 0);
    if (invoiceDiscount > 0) {
      pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
      pdf.text("Zwischensumme", MARGIN, y);
      pdf.text(`CHF ${fmt(subtotal, locale)}`, MARGIN, y, { width: CONTENT_W, align: "right" });
      y += LINE_HEIGHT + 4;
      pdf.text(`Gesamtrabatt (${fmt(invoiceDiscount, locale)} %)`, MARGIN, y);
      pdf.text(`- CHF ${fmt(subtotal - doc.totalAmount, locale)}`, MARGIN, y, {
        width: CONTENT_W,
        align: "right",
      });
      y += LINE_HEIGHT + 6;
    }

    pdf.font(BOLD).fontSize(TOTAL).fillColor(TEXT_COLOR);
    pdf.text("Gesamtbetrag", MARGIN, y);
    pdf.text(`CHF ${fmt(doc.totalAmount, locale)}`, MARGIN, y, {
      width: CONTENT_W,
      align: "right",
    });
    y += TOTAL + 7;
    rule(y, 1.5);
    y += 16;

    // ── Payment note + optional closing block ────────────────────────────
    const footerLines = theme.showFooter
      ? [theme.closingSalutation, company.companyHolderName, theme.footerNote].filter(Boolean).length
      : 0;
    const CLOSING_H = LINE_HEIGHT + 20 + footerLines * (LINE_HEIGHT + 2) + 10;
    if (y + CLOSING_H > PAGE_H - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }

    pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
    pdf.text(`${doc.closingNoteLabel} ${fmtDate(doc.dueDate, locale)}`, MARGIN, y);
    y += LINE_HEIGHT + 20;

    if (theme.showFooter) {
      if (theme.closingSalutation) {
        pdf.font(FONT).text(theme.closingSalutation, MARGIN, y);
        y += LINE_HEIGHT + 2;
      }
      if (company.companyHolderName) {
        pdf.font(BOLD).text(company.companyHolderName, MARGIN, y);
        y += LINE_HEIGHT + 2;
      }
      if (theme.footerNote) {
        pdf.font(FONT).fontSize(SMALL).fillColor(TEXT_COLOR);
        pdf.text(theme.footerNote, MARGIN, y, { width: CONTENT_W });
      }
    }

    // ── Swiss QR Bill (regulated — never themed) ─────────────────────────
    if (doc.qr) {
      pdf.addPage();
      new SwissQRBill(doc.qr).attachTo(pdf);
    }

    pdf.end();
  });
}

export { DEFAULT_THEME };
