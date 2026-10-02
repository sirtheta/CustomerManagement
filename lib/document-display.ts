export const DRAFT_LABEL = "Entwurf";

/** Display value for a document number; drafts have none until they are sent. */
export function documentLabel(documentNumber: string | null | undefined): string {
  return documentNumber || DRAFT_LABEL;
}

// Kept here for the existing callers; the placeholder logic lives in lib/mail-templates.ts.
export { fillDocumentNumber, fillTotalAmount } from "@/lib/mail-templates";
