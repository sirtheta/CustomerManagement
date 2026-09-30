"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createCreditNote } from "./actions";

export default function CreateCreditNoteButton({ invoiceId }: { invoiceId: number }) {
  return (
    <ConfirmDialog
      title="Gutschrift erstellen"
      description="Es wird ein Gutschrift-Entwurf mit allen Positionen dieser Rechnung angelegt. Du kannst Positionen streichen oder anpassen, bevor du die Gutschrift versendest."
      confirmLabel="Gutschrift erstellen"
      confirmVariant="default"
      triggerVariant="outline"
      onConfirm={() => createCreditNote(invoiceId)}
    >
      Gutschrift erstellen
    </ConfirmDialog>
  );
}
