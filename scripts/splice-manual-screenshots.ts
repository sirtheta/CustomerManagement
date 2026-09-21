/**
 * Splices PNGs captured by scripts/manual-screenshots.ts back into
 * public/benutzerhandbuch.html as inline base64 data URIs, matched by a
 * (unique) substring of each <img>'s alt text. Replaces whatever <img src>
 * is currently there (initially a placeholder SVG, later a previous shot).
 *
 * Usage: npx tsx scripts/splice-manual-screenshots.ts
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";

const MANUAL_PATH = path.join(__dirname, "..", "public", "benutzerhandbuch.html");
const SHOTS_DIR = path.join(__dirname, ".manual-shots");

// shot file name (without .png) -> unique substring of the target <img alt="...">
const ALT_MATCH: Record<string, string> = {
  login: "Anmeldeseite mit E-Mail und Passwort",
  profile: "Profilseite mit Passwort ändern",
  dashboard: "Dashboard mit Kennzahlen zu Rechnungen und Umsatz",
  customers: "Kundenliste mit Suche und Filter für geplante Jahresrechnungen",
  invoices: "Rechnungsliste mit Status-Filtern",
  "invoice-new": "Neue Rechnung mit Positionen und Kunde",
  quotes: "Offertenliste mit Status Entwurf, Versendet, Angenommen",
  services: "Leistungskatalog mit Einheit, Preis und Kategorie",
  analytics: "Auswertung mit Umsatzverlauf, Kategorien und Top-Kunden",
  accounting: "Buchhaltung mit Ausgaben und monatlicher Erfolgsrechnung",
  settings: "Einstellungsseite mit Firmendaten, Logo und SMTP-Konfiguration",
  "settings-design": "Dokument-Design mit Farbwahl und PDF-Vorschau",
  "settings-categories": "Kategorienverwaltung mit Farbzuordnung",
  "settings-users": "Benutzerverwaltung mit Rolle und Zwei-Faktor-Status",
  "two-factor-dialog": "Dialog Zwei-Faktor-Authentifizierung einrichten mit QR-Code",
  "settings-audit": "Aktivitätsprotokoll mit Filtern nach Aktion und Benutzer",
  "settings-logs": "Logs mit Download der aktuellen und archivierten Tagesdateien",
};

function main() {
  let html = readFileSync(MANUAL_PATH, "utf-8");
  const files = readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".png"));

  for (const file of files) {
    const name = file.replace(/\.png$/, "");
    const altSubstr = ALT_MATCH[name];
    if (!altSubstr) {
      console.warn("skip (no alt mapping):", file);
      continue;
    }
    const buf = readFileSync(path.join(SHOTS_DIR, file));
    const dataUri = `data:image/png;base64,${buf.toString("base64")}`;

    // Find the <img ... alt="...altSubstr...".../> tag and swap its src,
    // whatever the current src is (placeholder SVG or an earlier PNG).
    let matched = false;
    html = html.replace(
      new RegExp(`<img src="[^"]*"([^>]*alt="[^"]*${escapeRegExp(altSubstr)}[^"]*")`),
      (full, tail) => {
        matched = true;
        return `<img src="${dataUri}"${tail}`;
      },
    );
    if (!matched) {
      console.warn("no matching <img> found for:", name, "(alt contains:", altSubstr + ")");
    } else {
      console.log("spliced:", name, `(${Math.round(buf.length / 1024)} KB)`);
    }
  }

  writeFileSync(MANUAL_PATH, html);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
