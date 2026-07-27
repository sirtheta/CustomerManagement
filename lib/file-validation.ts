// Magic byte signatures per allowed upload extension. Extensions without an
// entry (plain text formats) have no binary signature and are not checked.
const MAGIC_BYTES: Record<string, number[][]> = {
  ".pdf":  [[0x25, 0x50, 0x44, 0x46]], // %PDF
  ".jpg":  [[0xff, 0xd8, 0xff]],
  ".jpeg": [[0xff, 0xd8, 0xff]],
  ".png":  [[0x89, 0x50, 0x4e, 0x47]],
  ".gif":  [[0x47, 0x49, 0x46, 0x38]], // GIF8
  ".bmp":  [[0x42, 0x4d]], // BM
  // OOXML formats are ZIP containers
  ".docx": [[0x50, 0x4b]],
  ".xlsx": [[0x50, 0x4b]],
  ".pptx": [[0x50, 0x4b]],
  ".zip":  [[0x50, 0x4b]],
  ".rar":  [[0x52, 0x61, 0x72, 0x21]], // Rar!
  ".7z":   [[0x37, 0x7a, 0xbc, 0xaf]],
};

/**
 * Checks that the file content matches the binary signature of its declared
 * extension, so renamed files (e.g. an HTML page as .pdf) are rejected.
 */
export function matchesMagicBytes(ext: string, bytes: Uint8Array): boolean {
  const signatures = MAGIC_BYTES[ext.toLowerCase()];
  if (!signatures) return true;
  return signatures.some((sig) => sig.every((b, i) => bytes[i] === b));
}

/**
 * Detects the renderable image type of a buffer from its magic bytes.
 * Returns null for anything that is not a PNG or JPEG (e.g. SVG, which could
 * carry scripts, or unrelated data). Single source of truth for the logo
 * route and PDF logo embedding.
 */
export function detectImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}
