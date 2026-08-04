/**
 * Rasterizes a single PDF page to a PNG. Standalone CLI, usable on its own:
 *
 *   npx tsx scripts/render-pdf-page.ts <pdf-file> <page-number> <out.png> [scale] [cropBottomFraction]
 *
 * cropBottomFraction (0-1) keeps only the bottom slice of the rendered page —
 * handy for the Swiss QR payment slip, which swissqrbill always places in the
 * bottom ~105mm of an A4 page (~0.354 of the page height).
 *
 * Used by scripts/marketing-screenshots.ts to turn a generated invoice PDF
 * into a screenshot-able PNG (Chromium's built-in PDF viewer isn't reliably
 * available in Playwright's bundled browser — top-level navigation to a PDF
 * triggers a download, and an <iframe> embed stays blank).
 *
 * Run as its own process (rather than imported as a function) because
 * calling pdfjs-dist's getDocument() more than once in the same process as
 * an active Playwright browser intermittently throws a DataCloneError from
 * its internal fake-worker message port — process isolation sidesteps it.
 */
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

async function main() {
  const [, , pdfPath, pageArg, outPath, scaleArg, cropArg] = process.argv;
  if (!pdfPath || !pageArg || !outPath) {
    console.error(
      "Usage: tsx scripts/render-pdf-page.ts <pdf-file> <page-number> <out.png> [scale] [cropBottomFraction]",
    );
    process.exit(1);
  }
  const pageNumber = Number(pageArg);
  const scale = scaleArg ? Number(scaleArg) : 2;
  const cropBottomFraction = cropArg ? Number(cropArg) : undefined;

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Node's font factory (auto-selected by pdfjs when it detects it's running
  // under Node) reads this with fs.readFile, so it wants a filesystem path —
  // not a file:// URL, which it treats as a literal (invalid) path. pdfjs
  // also requires a trailing forward slash regardless of platform.
  const standardFontDataUrl =
    path
      .join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")
      .split(path.sep)
      .join("/") + "/";

  const pdfBytes = new Uint8Array(readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes, standardFontDataUrl }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  // @ts-expect-error — @napi-rs/canvas's context is API-compatible with the
  // CanvasRenderingContext2D subset pdf.js needs, but its types don't line up.
  await page.render({ canvasContext: ctx, viewport }).promise;

  if (cropBottomFraction) {
    const cropHeight = Math.round(canvas.height * cropBottomFraction);
    const cropped = createCanvas(canvas.width, cropHeight);
    cropped
      .getContext("2d")
      .drawImage(canvas, 0, canvas.height - cropHeight, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
    writeFileSync(outPath, cropped.toBuffer("image/png"));
  } else {
    writeFileSync(outPath, canvas.toBuffer("image/png"));
  }

  // Emitted last so the parent process can grep it out even amid pdf.js's
  // own console warnings.
  console.log(`RESULT ${JSON.stringify({ numPages: pdf.numPages })}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
