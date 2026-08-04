/**
 * Turns the PNGs in marketing/screenshots/ (see marketing-screenshots.ts)
 * into a single HTML block for the "Screenshots" section of
 * https://nemicomp.ch/customer-management/ — <img> tags point at the
 * WordPress media library rather than embedding base64 data, so upload the
 * PNGs from marketing/screenshots/ to the WordPress media library FIRST
 * (keeping their filenames — see WP_IMAGE_BASE_URL below), then paste this
 * into an Elementor "HTML" widget.
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

// Where the PNGs from marketing/screenshots/ get uploaded to in WordPress
// (same filenames). Update this if WordPress assigns a different month/year
// folder or renames a file to avoid a collision (e.g. dashboard-2.png).
const WP_IMAGE_BASE_URL = "https://nemicomp.ch/wp-content/uploads/2026/08/";

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

// Only reads dimensions (for the <img width/height> layout-stability hint) —
// the file itself isn't touched or re-encoded, since WordPress hosts the
// original PNG from marketing/screenshots/ as-is.
async function imageMeta(file: string): Promise<{ url: string; width: number; height: number }> {
  const buf = readFileSync(path.join(SHOTS_DIR, file));
  const meta = await sharp(buf).metadata();
  return {
    url: WP_IMAGE_BASE_URL + file,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

// Assigns each imageFigure() call the index its <button> ends up at in the
// DOM, in display order, so cmMktOpenLightbox(index) in the browser lines up
// with cmMktImages() (which reads img elements straight off the page — see
// buildLightbox()).
let lightboxImageCount = 0;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageFigure(url: string, width: number, height: number, alt: string): string {
  const index = lightboxImageCount++;
  const img = `<img src="${url}" width="${width}" height="${height}" alt="${escapeHtml(alt)}" loading="lazy" style="display:block;width:100%;height:auto;border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,0.14);border:1px solid #e5e7eb;" />`;
  return `<button type="button" class="cm-mkt-trigger" onclick="cmMktOpenLightbox(${index})" aria-label="${escapeHtml(alt)} vergrössern" style="display:block;width:100%;padding:0;margin:0;border:0;background:none;cursor:zoom-in;">${img}</button>`;
}

// Self-contained click-to-enlarge lightbox: no external libraries (the block
// is pasted as-is into an Elementor HTML widget), classes/functions prefixed
// with cm-mkt to avoid colliding with the theme's own CSS/JS. Reads
// src/alt straight off the on-page <img> elements at open-time rather than
// carrying its own list, so it doesn't need to know the image URLs itself.
function buildLightbox(): string {
  return `
<style>
  .cm-mkt-trigger { transition: transform .15s ease; }
  .cm-mkt-trigger:hover { transform: scale(1.015); }
  .cm-mkt-lightbox { display: none; position: fixed; inset: 0; z-index: 99999; padding: 56px 24px; background: rgba(15,23,42,.92); align-items: center; justify-content: center; }
  .cm-mkt-lightbox.cm-mkt-open { display: flex; }
  .cm-mkt-lightbox-inner { position: relative; max-width: min(94vw, 1400px); max-height: 88vh; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .cm-mkt-lightbox-inner img { display: block; max-width: 100%; max-height: 78vh; width: auto; height: auto; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .cm-mkt-lightbox-caption { color: #e2e8f0; font-size: 15px; text-align: center; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; }
  .cm-mkt-lightbox-btn { position: absolute; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; border: 0; background: rgba(255,255,255,.12); color: #fff; font-size: 20px; line-height: 1; cursor: pointer; transition: background .15s ease; }
  .cm-mkt-lightbox-btn:hover { background: rgba(255,255,255,.24); }
  .cm-mkt-lightbox-close { top: -56px; right: 0; }
  .cm-mkt-lightbox-prev { left: -56px; top: 50%; transform: translateY(-50%); }
  .cm-mkt-lightbox-next { right: -56px; top: 50%; transform: translateY(-50%); }
  @media (max-width: 720px) {
    .cm-mkt-lightbox-prev { left: 0; }
    .cm-mkt-lightbox-next { right: 0; }
    .cm-mkt-lightbox-close { top: -48px; }
  }
</style>
<div id="cm-mkt-lightbox" class="cm-mkt-lightbox" role="dialog" aria-modal="true" aria-hidden="true" onclick="cmMktCloseLightbox()">
  <div class="cm-mkt-lightbox-inner" onclick="event.stopPropagation()">
    <button type="button" class="cm-mkt-lightbox-btn cm-mkt-lightbox-close" onclick="cmMktCloseLightbox()" aria-label="Schliessen">&times;</button>
    <button type="button" class="cm-mkt-lightbox-btn cm-mkt-lightbox-prev" onclick="cmMktStep(-1)" aria-label="Vorheriges Bild">&#8249;</button>
    <button type="button" class="cm-mkt-lightbox-btn cm-mkt-lightbox-next" onclick="cmMktStep(1)" aria-label="Nächstes Bild">&#8250;</button>
    <img id="cm-mkt-lightbox-img" src="" alt="" />
    <div id="cm-mkt-lightbox-caption" class="cm-mkt-lightbox-caption"></div>
  </div>
</div>
<script>
  (function () {
    var cmMktIndex = 0;

    function cmMktImages() {
      var imgs = document.querySelectorAll(".cm-mkt-trigger img");
      return Array.prototype.map.call(imgs, function (img) {
        return { src: img.src, alt: img.alt };
      });
    }

    function cmMktRender() {
      var item = cmMktImages()[cmMktIndex];
      document.getElementById("cm-mkt-lightbox-img").src = item.src;
      document.getElementById("cm-mkt-lightbox-img").alt = item.alt;
      document.getElementById("cm-mkt-lightbox-caption").textContent = item.alt;
    }

    window.cmMktOpenLightbox = function (index) {
      cmMktIndex = index;
      cmMktRender();
      var lb = document.getElementById("cm-mkt-lightbox");
      lb.classList.add("cm-mkt-open");
      lb.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    };

    window.cmMktCloseLightbox = function () {
      var lb = document.getElementById("cm-mkt-lightbox");
      lb.classList.remove("cm-mkt-open");
      lb.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };

    window.cmMktStep = function (delta) {
      var total = cmMktImages().length;
      cmMktIndex = (cmMktIndex + delta + total) % total;
      cmMktRender();
    };

    document.addEventListener("keydown", function (e) {
      var lb = document.getElementById("cm-mkt-lightbox");
      if (!lb || !lb.classList.contains("cm-mkt-open")) return;
      if (e.key === "Escape") window.cmMktCloseLightbox();
      if (e.key === "ArrowRight") window.cmMktStep(1);
      if (e.key === "ArrowLeft") window.cmMktStep(-1);
    });
  })();
</script>`;
}

async function main() {
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const rows: string[] = [];

  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    const { url, width, height } = await imageMeta(s.file);
    const reverse = i % 2 === 1;
    rows.push(`
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:48px;margin:0 0 88px;${reverse ? "flex-direction:row-reverse;" : ""}">
      <div style="flex:1 1 480px;min-width:280px;">
        ${imageFigure(url, width, height, s.title)}
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
  const [invoice, qr] = await Promise.all(PDF_SECTION.files.map(imageMeta));
  rows.push(`
    <div style="margin:0 0 24px;text-align:center;">
      <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;margin:0 0 10px;">${PDF_SECTION.eyebrow}</div>
      <h3 style="font-size:26px;line-height:1.25;margin:0 auto 14px;color:#0f172a;max-width:640px;">${PDF_SECTION.title}</h3>
      <p style="font-size:17px;line-height:1.6;color:#475569;margin:0 auto;max-width:640px;">${PDF_SECTION.text}</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:32px;justify-content:center;align-items:flex-start;">
      <div style="flex:1 1 320px;max-width:420px;">
        ${imageFigure(invoice.url, invoice.width, invoice.height, "Beispiel einer Rechnung als PDF")}
      </div>
      <div style="flex:1 1 320px;max-width:420px;">
        ${imageFigure(qr.url, qr.width, qr.height, "Schweizer QR-Rechnung Zahlteil mit QR-Code")}
      </div>
    </div>`);

  const html = `<!-- Screenshots-Sektion — generiert von scripts/generate-marketing-html.ts, nicht von Hand editieren. -->
<section style="max-width:1120px;margin:0 auto;padding:64px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  ${rows.join("\n")}
</section>
${buildLightbox()}
`;

  writeFileSync(OUT_FILE, html);
  const sizeKb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`Wrote ${OUT_FILE} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
