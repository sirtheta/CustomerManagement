import { readFileSync } from "fs";
import path from "path";
import logger from "@/lib/logger";
import type { PdfFont } from "@/lib/pdf/theme";

const log = logger.child({ module: "pdf-fonts" });

// Server-only: resolves and caches embedded font binaries and registers them on
// a PDFDocument. pdfkit/fontkit reads .woff buffers directly. The @fontsource
// packages are prod dependencies, so their files ship in the Docker image.
//
// Files are read via a plain filesystem path (not require.resolve) so the
// bundler does not try to statically resolve a dynamic module specifier. This
// assumes a flat node_modules layout (npm); revisit if the project moves to
// pnpm's nested store.
const FONTS_DIR = path.join(process.cwd(), "node_modules", "@fontsource");

// [regular 400, bold 700] paths (relative to @fontsource) per embedded family.
const EMBEDDED: Partial<Record<PdfFont, [string, string]>> = {
  Lato: ["lato/files/lato-latin-400-normal.woff", "lato/files/lato-latin-700-normal.woff"],
  Roboto: ["roboto/files/roboto-latin-400-normal.woff", "roboto/files/roboto-latin-700-normal.woff"],
  Montserrat: [
    "montserrat/files/montserrat-latin-400-normal.woff",
    "montserrat/files/montserrat-latin-700-normal.woff",
  ],
  Lora: ["lora/files/lora-latin-400-normal.woff", "lora/files/lora-latin-700-normal.woff"],
};

// Bold variant for the pdfkit built-in families.
const BUILTIN_BOLD: Record<string, string> = {
  Helvetica: "Helvetica-Bold",
  "Times-Roman": "Times-Bold",
};

const bufferCache = new Map<string, Buffer>();
function loadFont(rel: string): Buffer {
  let buf = bufferCache.get(rel);
  if (!buf) {
    buf = readFileSync(path.join(FONTS_DIR, rel));
    bufferCache.set(rel, buf);
  }
  return buf;
}

/**
 * Resolve the regular/bold pdfkit font names for a theme font, registering the
 * embedded family on the document when needed. Falls back to Helvetica for an
 * unknown family.
 */
function builtin(family: PdfFont): { regular: string; bold: string } {
  const reg = family in BUILTIN_BOLD ? family : "Helvetica";
  return { regular: reg, bold: BUILTIN_BOLD[reg] ?? "Helvetica-Bold" };
}

export function applyFonts(
  doc: PDFKit.PDFDocument,
  family: PdfFont
): { regular: string; bold: string } {
  const embedded = EMBEDDED[family];
  if (!embedded) return builtin(family);

  try {
    const regular = `body-${family}`;
    const bold = `body-${family}-bold`;
    doc.registerFont(regular, loadFont(embedded[0]));
    doc.registerFont(bold, loadFont(embedded[1]));
    return { regular, bold };
  } catch (err) {
    // A missing/corrupt font file must not break PDF generation.
    log.error({ family, err }, "embedded font load failed; falling back to Helvetica");
    return builtin("Helvetica");
  }
}
