export const DRAFT_LABEL = "Entwurf";

/** Display value for a document number; drafts have none until they are sent. */
export function documentLabel(documentNumber: string | null | undefined): string {
  return documentNumber || DRAFT_LABEL;
}

/** Replaces the {documentNumber} placeholder once the number is known (at send time). */
export function fillDocumentNumber(text: string, documentNumber: string): string {
  return text.replace(/\{documentNumber\}/g, documentNumber);
}
