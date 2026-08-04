/**
 * Turns the PNGs in marketing/screenshots/ (see marketing-screenshots.ts)
 * into a single self-contained HTML block for the "Screenshots" section of
 * https://nemicomp.ch/customer-management/ — images embedded as base64 data
 * URIs so it can be pasted directly into an Elementor "HTML" widget with no
 * separate media upload step.
 *
 * Usage:
 *   npx tsx scripts/generate-marketing-html.ts
 *
 * Writes marketing/screenshots-section.html. Re-run after
 * marketing-screenshots.ts whenever the UI changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";

const ROOT = path.resolve(__dirname, "..");
const SHOTS_DIR = path.join(ROOT, "marketing", "screenshots");
const OUT_FILE = path.join(ROOT, "marketing", "screenshots-section.html");

// Re-encoded to WebP (much smaller than PNG for these mostly-flat UI
// screenshots) and capped at this width — still sharp on a retina display at
// the sizes this section actually renders images.
const MAX_WIDTH = 1400;
const WEBP_QUALITY = 82;

type Section = {
  file: string;
  eyebrow: string;
  title: string;
  text: string;
};

const SECTIONS: Section[] = [
  {
    file: "dashboard.png",
    eyebrow: "Übersicht",
    title: "Alles auf einen Blick",
    text: "Offene Rechnungen, offene Offerten, Jahresumsatz und überfällige Zahlungen sofort sichtbar beim Einloggen – ohne Klicks, ohne Suchen.",
  },
  {
    file: "customers.png",
    eyebrow: "Kundenverwaltung",
    title: "Kunden einfach und übersichtlich verwalten",
    text: "Volltextsuche über Firma, Kontakt und Ort, CSV-Export und alle wichtigen Informationen auf einen Blick.",
  },
  {
    file: "invoices-overview.png",
    eyebrow: "Rechnungen & Offerten",
    title: "Immer den Überblick behalten",
    text: "Status auf einen Blick – Entwurf, versendet, bezahlt oder überfällig. Mit Filtern nach Zeitraum und Status schnell die richtige Rechnung finden.",
  },
  {
    file: "invoice-new.png",
    eyebrow: "Erstellung",
    title: "Neue Rechnungen und Offerten in Sekunden",
    text: "Kunde auswählen, Positionen aus der Leistungsdatenbank oder frei erfassen – der Gesamtbetrag wird automatisch berechnet.",
  },
  {
    file: "analytics.png",
    eyebrow: "Auswertungen",
    title: "Umsatz und Kennzahlen auf einen Blick",
    text: "Monatlicher Umsatzverlauf, Einnahmen und Ausgaben nach Kategorie sowie die Top-Kunden – interaktiv und mit Drilldown bis zur einzelnen Rechnung.",
  },
  {
    file: "accounting.png",
    eyebrow: "Buchhaltung",
    title: "Erfolgsrechnung ohne Excel",
    text: "Einnahmen, Ausgaben und Ergebnis pro Monat auf einen Blick, inklusive Gewinn- und Verlust-Chart und CSV-Export für die Steuererklärung.",
  },
  {
    file: "settings-design.png",
    eyebrow: "Individualisierung",
    title: "Rechnungsdesign nach Ihrem Geschmack",
    text: "Akzentfarbe, Schriftart, Logo-Position und Inhalte frei wählbar – mit Live-Vorschau der echten PDF-Rechnung.",
  },
];

const PDF_SECTION = {
  eyebrow: "PDF-Export",
  title: "Professionell gestaltete Rechnungen mit Schweizer QR-Code",
  text: "Jede Rechnung wird als fertige PDF-Datei mit Schweizer QR-Rechnung erzeugt – bereit zum Versand oder Druck, direkt bezahlbar per QR-Code am Bankomat oder in der E-Banking-App.",
  files: ["invoice-pdf.png", "invoice-pdf-qr.png"],
};

async function toDataUri(file: string): Promise<{ dataUri: string; width: number; height: number }> {
  const buf = readFileSync(path.join(SHOTS_DIR, file));
  const resized = sharp(buf).resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY });
  const [output, meta] = await Promise.all([resized.toBuffer(), resized.metadata()]);
  return {
    dataUri: `data:image/webp;base64,${output.toString("base64")}`,
    width: meta.width ?? MAX_WIDTH,
    height: meta.height ?? 0,
  };
}

function imageFigure(dataUri: string, width: number, height: number, alt: string): string {
  return `<img src="${dataUri}" width="${width}" height="${height}" alt="${alt}" loading="lazy" style="display:block;width:100%;height:auto;border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,0.14);border:1px solid #e5e7eb;" />`;
}

async function main() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const rows: string[] = [];

  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    const { dataUri, width, height } = await toDataUri(s.file);
    const reverse = i % 2 === 1;
    rows.push(`
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:48px;margin:0 0 88px;${reverse ? "flex-direction:row-reverse;" : ""}">
      <div style="flex:1 1 480px;min-width:280px;">
        ${imageFigure(dataUri, width, height, s.title)}
      </div>
      <div style="flex:1 1 360px;min-width:260px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;margin:0 0 10px;">${s.eyebrow}</div>
        <h3 style="font-size:26px;line-height:1.25;margin:0 0 14px;color:#0f172a;">${s.title}</h3>
        <p style="font-size:17px;line-height:1.6;color:#475569;margin:0;">${s.text}</p>
      </div>
    </div>`);
  }

  // Paired invoice + QR-bill close-up, side by side — mirrors the old
  // showcase's final "invoice + QR" pairing.
  const [invoice, qr] = await Promise.all(PDF_SECTION.files.map(toDataUri));
  rows.push(`
    <div style="margin:0 0 24px;text-align:center;">
      <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;margin:0 0 10px;">${PDF_SECTION.eyebrow}</div>
      <h3 style="font-size:26px;line-height:1.25;margin:0 auto 14px;color:#0f172a;max-width:640px;">${PDF_SECTION.title}</h3>
      <p style="font-size:17px;line-height:1.6;color:#475569;margin:0 auto;max-width:640px;">${PDF_SECTION.text}</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:32px;justify-content:center;align-items:flex-start;">
      <div style="flex:1 1 320px;max-width:420px;">
        ${imageFigure(invoice.dataUri, invoice.width, invoice.height, "Beispiel einer Rechnung als PDF")}
      </div>
      <div style="flex:1 1 320px;max-width:420px;">
        ${imageFigure(qr.dataUri, qr.width, qr.height, "Schweizer QR-Rechnung Zahlteil mit QR-Code")}
      </div>
    </div>`);

  const html = `<!-- Screenshots-Sektion — generiert von scripts/generate-marketing-html.ts, nicht von Hand editieren. -->
<section style="max-width:1120px;margin:0 auto;padding:64px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  ${rows.join("\n")}
</section>
`;

  writeFileSync(OUT_FILE, html);
  const sizeKb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`Wrote ${OUT_FILE} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
