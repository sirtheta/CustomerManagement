"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteInvoice } from "./actions";

type Props = {
  invoiceId: number;
  isCreditNote?: boolean;
  /** Validated `?from=` of the detail page, so deleting returns there. */
  from?: string | null;
};

export default function DeleteInvoiceButton({ invoiceId, isCreditNote = false, from }: Props) {
  const noun = isCreditNote ? "Gutschrift" : "Rechnung";
  const demonstrative = isCreditNote ? "diese Gutschrift" : "diese Rechnung";
  return (
    <ConfirmDialog
      title={`${noun} löschen`}
      description={`Soll ${demonstrative} wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.`}
      confirmLabel="Löschen"
      onConfirm={() => deleteInvoice(invoiceId, from)}
    >
      {noun} löschen
    </ConfirmDialog>
  );
}
