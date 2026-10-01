import { matchesMagicBytes } from "@/lib/file-validation";

export const MAX_RECEIPT_SIZE = 5 * 1024 * 1024; // 5 MB

export const RECEIPT_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export type ValidReceipt = {
  name: string;
  fileType: string;
  size: number;
  content: Uint8Array<ArrayBuffer>;
};

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot).toLowerCase();
}

/**
 * Validates the uploaded receipt files (PDF or JPG/PNG, max. 5 MB, content
 * must match the extension). Empty file inputs are skipped. Returns either
 * the files ready to store or a German error message for the first bad file.
 */
export async function readReceipts(
  files: FormDataEntryValue[]
): Promise<{ receipts: ValidReceipt[] } | { error: string }> {
  const receipts: ValidReceipt[] = [];
  for (const entry of files) {
    if (!(entry instanceof File) || entry.size === 0) continue;

    if (entry.size > MAX_RECEIPT_SIZE)
      return { error: `Beleg zu gross (max. 5 MB): ${entry.name}` };

    const ext = getExtension(entry.name);
    if (!RECEIPT_MIME_TYPES[ext])
      return { error: `Dateityp nicht erlaubt (nur PDF, JPG, PNG): ${entry.name}` };

    const content = new Uint8Array(await entry.arrayBuffer());
    if (!matchesMagicBytes(ext, content))
      return { error: `Dateiinhalt entspricht nicht dem Dateityp ${ext}: ${entry.name}` };

    receipts.push({ name: entry.name, fileType: ext, size: content.length, content });
  }
  return { receipts };
}
