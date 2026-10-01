export const DRAFT_LABEL = "Entwurf";

/** Display value for a document number; drafts have none until they are sent. */
export function documentLabel(documentNumber: string | null | undefined): string {
  return documentNumber || DRAFT_LABEL;
}

/** Replaces the {documentNumber} placeholder once the number is known (at send time). */
export function fillDocumentNumber(text: string, documentNumber: string): string {
  return text.replace(/\{documentNumber\}/g, () => documentNumber);
}

/** Replaces the {totalAmount} placeholder with the formatted invoice total (at send time, after edits). */
export function fillTotalAmount(text: string, formattedTotal: string): string {
  return text.replace(/\{totalAmount\}/g, () => formattedTotal);
}
