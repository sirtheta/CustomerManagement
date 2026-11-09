import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import {
  compressUpload,
  isSignedPdf,
  MAX_IMAGE_DIMENSION,
  ghostscriptBinary,
} from "@/lib/file-compression";

/** Noisy RGB image, so JPEG/PNG cannot shrink it trivially. */
async function noisyImage(width: number, height: number, format: "jpeg" | "png") {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "jpeg" ? img.jpeg({ quality: 100 }).toBuffer() : img.png().toBuffer();
}

async function pdfWithImage(): Promise<Buffer> {
  const jpeg = await noisyImage(1800, 1200, "jpeg");
  const doc = new PDFDocument({ size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  doc.image(jpeg, 20, 20, { width: 300 }); // placed at ~440 dpi
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

const gsAvailable = spawnSync(ghostscriptBinary(), ["--version"]).status === 0;

describe("compressUpload – images", () => {
  it("downsizes large JPEGs to the maximum edge and makes them smaller", async () => {
    const original = await noisyImage(3200, 2400, "jpeg");
    const result = await compressUpload(".jpg", new Uint8Array(original));
    expect(result.length).toBeLessThan(original.length);
    const meta = await sharp(Buffer.from(result)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_IMAGE_DIMENSION);
  });

  it("keeps PNGs as PNG", async () => {
    const original = await noisyImage(2400, 1800, "png");
    const result = await compressUpload(".png", new Uint8Array(original));
    const meta = await sharp(Buffer.from(result)).metadata();
    expect(meta.format).toBe("png");
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_IMAGE_DIMENSION);
  });

  it("never enlarges small images or makes them bigger", async () => {
    const original = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#888" },
    })
      .jpeg({ quality: 40 })
      .toBuffer();
    const result = await compressUpload(".jpeg", new Uint8Array(original));
    expect(result.length).toBeLessThanOrEqual(original.length);
    const meta = await sharp(Buffer.from(result)).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
  });

  it("returns the original when re-encoding does not save at least 10 %", async () => {
    // Already at the target quality and size: nothing worth rewriting
    const original = await sharp(await noisyImage(800, 600, "jpeg"))
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    const bytes = new Uint8Array(original);
    expect(await compressUpload(".jpg", bytes)).toBe(bytes);
  });

  it("returns the original when the bytes are not a decodable image", async () => {
    const garbage = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
    expect(await compressUpload(".jpg", garbage)).toBe(garbage);
  });

  it("leaves other file types untouched", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 1, 2, 3]);
    expect(await compressUpload(".docx", bytes)).toBe(bytes);
    expect(await compressUpload(".gif", bytes)).toBe(bytes);
  });
});

describe("compressUpload – PDFs", () => {
  const savedBin = process.env.GHOSTSCRIPT_BIN;
  afterEach(() => {
    if (savedBin === undefined) delete process.env.GHOSTSCRIPT_BIN;
    else process.env.GHOSTSCRIPT_BIN = savedBin;
  });

  it("detects digital signatures", () => {
    const signed = new TextEncoder().encode("%PDF-1.7 /Type/Sig /ByteRange [0 10 20 30]");
    const plain = new TextEncoder().encode("%PDF-1.7 hello");
    expect(isSignedPdf(signed)).toBe(true);
    expect(isSignedPdf(plain)).toBe(false);
  });

  it("returns the original when Ghostscript is not installed", async () => {
    process.env.GHOSTSCRIPT_BIN = "definitely-not-installed-gs";
    const pdf = new Uint8Array(await pdfWithImage());
    expect(await compressUpload(".pdf", pdf)).toBe(pdf);
  });

  it("skips signed PDFs", async () => {
    const signed = new TextEncoder().encode("%PDF-1.7 /ByteRange [0 1 2 3]");
    expect(await compressUpload(".pdf", signed)).toBe(signed);
  });

  it.skipIf(!gsAvailable)("shrinks PDFs with oversized images", async () => {
    const pdf = new Uint8Array(await pdfWithImage());
    const result = await compressUpload(".pdf", pdf);
    expect(result.length).toBeLessThan(pdf.length * 0.9);
    expect(Buffer.from(result.slice(0, 4)).toString()).toBe("%PDF");
  });
});
