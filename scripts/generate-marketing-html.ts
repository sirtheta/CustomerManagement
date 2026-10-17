/**
 * Turns the PNGs in marketing/screenshots/ (see marketing-screenshots.ts)
 * into a single HTML block for the "Screenshots" section of
 * https://nemicomp.ch/nemicomp-quote-invoice/ — <img> tags point at the
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
const WP_IMAGE_BASE_URL = "https://nemicomp.ch/wp-content/uploads/2026/10/";

type Split = {
  kind: "split";
  file: string;
  eyebrow: string;
  title: string;
  text: string;
};

// Several images side by side under a centered heading (PDF pages, phone screens).
type Pair = {
  kind: "pair";
  eyebrow: string;
  title: string;
  text: string;
  files: { file: string; alt: string }[];
  maxWidth: number;
};

type Block = Split | Pair;

// Order = order on the page; splits alternate image left/right. Kept short on purpose:
// the feature cards above (features-section.html) cover the basics, these show the workflow.
// Screenshots that are captured but not used here: customers, invoices-overview, receivables,
// analytics, settings-design.
const BLOCKS: Block[] = [
  {
    kind: "split",
    file: "dashboard.png",
    eyebrow: "Übersicht",
    title: "Alles auf einen Blick",
    text: "Offene Rechnungen, Einnahmen, fällige Mahnungen und Aufgaben siehst du sofort beim Einloggen – ohne Klicks, ohne Suchen.",
  },
  {
    kind: "split",
    file: "customer-detail.png",
    eyebrow: "Kunden",
    title: "Die ganze Geschichte eines Kunden an einem Ort",
    text: "Rechnungen, Offerten, Zahlungen und Mails im Verlauf. Aufgaben erinnern dich, zum Beispiel ans Nachfassen nach einer Offerte.",
  },
  {
    kind: "split",
    file: "invoice-new.png",
    eyebrow: "Rechnungen & Offerten",
    title: "Neue Rechnungen in Sekunden",
    text: "Kunde wählen, Positionen aus der Leistungsdatenbank übernehmen, fertig. Der Betrag wird automatisch berechnet.",
  },
  {
    kind: "split",
    file: "subscriptions.png",
    eyebrow: "Abonnements",
    title: "Wiederkehrende Rechnungen laufen von selbst",
    text: "Monatlich, quartalsweise oder jährlich: Die Rechnung entsteht automatisch und geht nach deiner Prüfung raus – oder ganz ohne Zutun.",
  },
  {
    kind: "split",
    file: "reminders.png",
    eyebrow: "Mahnwesen",
    title: "Überfällige Zahlungen konsequent nachfassen",
    text: "Überfällige Rechnungen werden erkannt und in vier Stufen gemahnt – auf Wunsch mit Mahngebühr und Verzugszins.",
  },
  {
    kind: "split",
    file: "bank-import.png",
    eyebrow: "Bankimport",
    title: "Zahlungseingänge in Minuten verbucht",
    text: "Kontoauszug aus dem E-Banking hochladen – Zahlungen werden den Rechnungen automatisch zugeordnet.",
  },
  {
    kind: "pair",
    eyebrow: "Zeiterfassung",
    title: "Zeit und Material unterwegs erfassen",
    text: "Direkt beim Kunden mit dem Smartphone erfassen und am Monatsende per Tippen in einen Rechnungsentwurf verwandeln.",
    files: [
      { file: "time-capture.png", alt: "Zeiterfassung auf dem Smartphone" },
      { file: "time-open.png", alt: "Offene Einträge verrechnen auf dem Smartphone" },
    ],
    maxWidth: 300,
  },
  {
    kind: "split",
    file: "accounting.png",
    eyebrow: "Buchhaltung",
    title: "Erfolgsrechnung ohne Excel",
    text: "Einnahmen, Ausgaben und Ergebnis pro Monat – dazu das Jahrespaket für die Steuererklärung.",
  },
  {
    kind: "pair",
    eyebrow: "PDF-Export",
    title: "Rechnungen mit Schweizer QR-Code",
    text: "Jede Rechnung wird als fertiges PDF mit QR-Rechnung erzeugt – bereit zum Versand oder Druck und direkt per E-Banking bezahlbar.",
    files: [
      { file: "invoice-pdf.png", alt: "Beispiel einer Rechnung als PDF" },
      { file: "invoice-pdf-qr.png", alt: "Schweizer QR-Rechnung Zahlteil mit QR-Code" },
    ],
    maxWidth: 420,
  },
];

// Same target as the menu's "Kontakt" and the page's "Kostenlos testen" button: the theme's contact popup.
const CONTACT_URL = "#omw-323";

const HOSTING = {
  eyebrow: "Hosting",
  title: "Ich hoste und betreue deine Kundenverwaltung",
  text: "Du möchtest dich nicht um Technik kümmern? Dann betreibe ich die Software für dich – du meldest dich einfach an und arbeitest.",
  bullets: ["Kein eigener Server nötig", "Updates und Wartung durch mich", "Nächtliche Datensicherung"],
  cta: "Unverbindlich anfragen",
  note: "Ich berate dich gerne persönlich.",
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
  let splitIndex = 0;

  for (const block of BLOCKS) {
    if (block.kind === "split") {
      const { url, width, height } = await imageMeta(block.file);
      const reverse = splitIndex++ % 2 === 1;
      rows.push(`
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:48px;margin:0 0 88px;${reverse ? "flex-direction:row-reverse;" : ""}">
      <div style="flex:1 1 480px;min-width:280px;">
        ${imageFigure(url, width, height, block.title)}
      </div>
      <div style="flex:1 1 360px;min-width:260px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;margin:0 0 10px;">${block.eyebrow}</div>
        <h3 style="font-size:26px;line-height:1.25;margin:0 0 14px;color:#0f172a;">${block.title}</h3>
        <p style="font-size:17px;line-height:1.6;color:#475569;margin:0;">${block.text}</p>
      </div>
    </div>`);
      continue;
    }

    // Centered heading, then the images side by side.
    const metas = await Promise.all(block.files.map((f) => imageMeta(f.file)));
    const figures = metas
      .map(
        (m, i) => `
      <div style="flex:1 1 ${Math.min(320, block.maxWidth)}px;max-width:${block.maxWidth}px;">
        ${imageFigure(m.url, m.width, m.height, block.files[i].alt)}
      </div>`,
      )
      .join("");
    rows.push(`
    <div style="margin:0 0 24px;text-align:center;">
      <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f46e5;margin:0 0 10px;">${block.eyebrow}</div>
      <h3 style="font-size:26px;line-height:1.25;margin:0 auto 14px;color:#0f172a;max-width:640px;">${block.title}</h3>
      <p style="font-size:17px;line-height:1.6;color:#475569;margin:0 auto;max-width:640px;">${block.text}</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:32px;justify-content:center;align-items:flex-start;margin:0 0 88px;">${figures}
    </div>`);
  }

  rows.push(`
    <div style="margin:0;padding:48px 40px;border-radius:16px;background:linear-gradient(135deg,#312e81 0%,#4f46e5 100%);color:#fff;display:flex;flex-wrap:wrap;align-items:center;gap:32px 56px;">
      <div style="flex:1 1 380px;min-width:260px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c7d2fe;margin:0 0 10px;">${HOSTING.eyebrow}</div>
        <h3 style="font-size:30px;line-height:1.25;margin:0 0 14px;color:#fff;">${HOSTING.title}</h3>
        <p style="font-size:17px;line-height:1.6;color:#e0e7ff;margin:0;">${HOSTING.text}</p>
      </div>
      <div style="flex:1 1 300px;min-width:260px;">
        <ul style="list-style:none;margin:0 0 28px;padding:0;">
          ${HOSTING.bullets
            .map(
              (b) =>
                `<li style="display:flex;gap:12px;align-items:flex-start;font-size:17px;line-height:1.5;color:#fff;margin:0 0 12px;"><span aria-hidden="true" style="flex:none;font-weight:700;color:#a5b4fc;">&#10003;</span><span>${b}</span></li>`,
            )
            .join("\n          ")}
        </ul>
        <a href="${CONTACT_URL}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#fff;color:#312e81;font-size:17px;font-weight:700;text-decoration:none;">${HOSTING.cta}</a>
        <div style="font-size:15px;color:#c7d2fe;margin:12px 0 0;">${HOSTING.note}</div>
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
