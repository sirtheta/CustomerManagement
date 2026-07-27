// PDF theme: the safe, user-customizable styling layer for invoice/quote PDFs.
// The Swiss QR bill is regulated and never themed. Defaults below reproduce the
// historical hardcoded look exactly, so installs without a stored theme render
// byte-for-byte as before.

// "Helvetica" and "Times-Roman" are pdfkit built-ins; the rest are embedded
// (@fontsource .woff files) and registered at render time in lib/pdf/fonts.ts.
// This list is client-safe (no font binaries) — the form imports it.
export const PDF_FONTS = [
  "Helvetica",
  "Times-Roman",
  "Lato",
  "Roboto",
  "Montserrat",
  "Lora",
] as const;
export type PdfFont = (typeof PDF_FONTS)[number];

export type PdfTheme = {
  /** Hex color for title, rules and the total line. Default black = legacy look. */
  accentColor: string;
  fontFamily: PdfFont;
  /** Base body font size in pt; other sizes derive from this. */
  baseFontSize: number;
  /** Page margin in pt. */
  margin: number;
  /** Logo bounding box in pt. */
  logoMaxSize: number;
  logoPosition: "left" | "right";
  /** Fill the items-table header row with the accent color (white text). */
  tableHeaderFill: boolean;
  showPhone: boolean;
  showEmail: boolean;
  /** Render the closing block (salutation, holder name, footer note). */
  showFooter: boolean;
  closingSalutation: string;
  footerNote: string;
};

export const DEFAULT_THEME: PdfTheme = {
  accentColor: "#000000",
  fontFamily: "Helvetica",
  baseFontSize: 10,
  margin: 40,
  logoMaxSize: 90,
  logoPosition: "left",
  tableHeaderFill: false,
  showPhone: true,
  showEmail: true,
  showFooter: true,
  closingSalutation: "Freundliche Grüsse",
  footerNote: "",
};

// Bounds keep a malformed/hostile theme from producing an unrenderable PDF.
const BOUNDS = {
  baseFontSize: { min: 7, max: 14 },
  margin: { min: 20, max: 70 },
  logoMaxSize: { min: 40, max: 160 },
} as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TEXT = 200;

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function textOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  return v.slice(0, MAX_TEXT);
}

/**
 * Merge a stored/draft theme blob over the defaults, dropping invalid fields.
 * Always returns a complete, render-safe PdfTheme.
 */
export function resolveTheme(raw: unknown): PdfTheme {
  const t = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PdfTheme, unknown>>;
  const d = DEFAULT_THEME;
  return {
    accentColor: typeof t.accentColor === "string" && HEX_RE.test(t.accentColor) ? t.accentColor : d.accentColor,
    fontFamily: PDF_FONTS.includes(t.fontFamily as PdfFont) ? (t.fontFamily as PdfFont) : d.fontFamily,
    baseFontSize: clampNum(t.baseFontSize, d.baseFontSize, BOUNDS.baseFontSize.min, BOUNDS.baseFontSize.max),
    margin: clampNum(t.margin, d.margin, BOUNDS.margin.min, BOUNDS.margin.max),
    logoMaxSize: clampNum(t.logoMaxSize, d.logoMaxSize, BOUNDS.logoMaxSize.min, BOUNDS.logoMaxSize.max),
    logoPosition: t.logoPosition === "right" ? "right" : "left",
    tableHeaderFill: boolOr(t.tableHeaderFill, d.tableHeaderFill),
    showPhone: boolOr(t.showPhone, d.showPhone),
    showEmail: boolOr(t.showEmail, d.showEmail),
    showFooter: boolOr(t.showFooter, d.showFooter),
    closingSalutation: textOr(t.closingSalutation, d.closingSalutation),
    footerNote: textOr(t.footerNote, d.footerNote),
  };
}

/**
 * Short stable revision string for a theme, used in the PDF cache key so a
 * theme change invalidates previously cached documents. Pure JS (djb2) — safe
 * to import from both server and client bundles.
 */
export function themeRevision(raw: unknown): string {
  const json = JSON.stringify(resolveTheme(raw));
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
