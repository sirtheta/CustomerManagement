import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import logger from "@/lib/logger";

const execFileAsync = promisify(execFile);

/** Longest edge of stored images in pixels (~135 dpi on A4). Smaller images are never enlarged. */
export const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 80;
/** A result is only used if it is at least this much smaller than the original. */
const MIN_SAVING_RATIO = 0.9;
const GHOSTSCRIPT_TIMEOUT_MS = 30_000;

let warnedMissingGhostscript = false;

export function ghostscriptBinary(): string {
  return process.env.GHOSTSCRIPT_BIN || (process.platform === "win32" ? "gswin64c" : "gs");
}

/** Rewriting a PDF invalidates a digital signature, so signed PDFs are stored as received. */
export function isSignedPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes("/ByteRange");
}

function isSmallEnough(result: Uint8Array, original: Uint8Array): boolean {
  return result.length < original.length * MIN_SAVING_RATIO;
}

async function compressImage(ext: string, bytes: Uint8Array): Promise<Uint8Array> {
  // rotate() applies the EXIF orientation; sharp drops the metadata (incl. GPS) on output.
  const pipeline = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  const out =
    ext === ".png"
      ? await pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer()
      : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  return new Uint8Array(out);
}

async function compressPdf(bytes: Uint8Array): Promise<Uint8Array> {
  if (isSignedPdf(bytes)) return bytes;
  const dir = await mkdtemp(join(tmpdir(), "cm-pdf-"));
  try {
    const input = join(dir, "in.pdf");
    const output = join(dir, "out.pdf");
    await writeFile(input, bytes);
    await execFileAsync(
      ghostscriptBinary(),
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.5",
        "-dPDFSETTINGS=/ebook", // images downsampled to 150 dpi
        "-dNOPAUSE",
        "-dBATCH",
        "-dQUIET",
        "-dSAFER",
        `-sOutputFile=${output}`,
        input,
      ],
      { timeout: GHOSTSCRIPT_TIMEOUT_MS, windowsHide: true }
    );
    const result = new Uint8Array(await readFile(output));
    // Output must itself be a PDF (%PDF)
    if (result[0] !== 0x25 || result[1] !== 0x50 || result[2] !== 0x44 || result[3] !== 0x46)
      return bytes;
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Shrinks an uploaded file before it is stored in the database: JPG/PNG are
 * downscaled and re-encoded with sharp, PDFs are rewritten with Ghostscript.
 * The result is only used if it is clearly smaller; every other type, every
 * failure and a missing Ghostscript return the original bytes. Never throws,
 * so compression can never make an upload fail.
 */
export async function compressUpload(ext: string, bytes: Uint8Array): Promise<Uint8Array> {
  const type = ext.toLowerCase();
  try {
    let result: Uint8Array;
    if (type === ".jpg" || type === ".jpeg" || type === ".png") result = await compressImage(type, bytes);
    else if (type === ".pdf") result = await compressPdf(bytes);
    else return bytes;
    return isSmallEnough(result, bytes) ? result : bytes;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Ghostscript not installed: say so once instead of on every upload
      if (!warnedMissingGhostscript) {
        warnedMissingGhostscript = true;
        logger.warn({ bin: ghostscriptBinary() }, "Ghostscript not found, PDFs are stored uncompressed");
      }
    } else {
      logger.warn({ err, ext: type }, "Upload compression failed, storing the original");
    }
    return bytes;
  }
}
