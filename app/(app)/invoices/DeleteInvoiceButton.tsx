"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteInvoice } from "./actions";

type Props = {
  invoiceId: number;
};

export default function DeleteInvoiceButton({ invoiceId }: Props) {
  return (
    <ConfirmDialog
      title="Rechnung löschen"
      description="Soll diese Rechnung wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden."
      confirmLabel="Löschen"
      onConfirm={() => deleteInvoice(invoiceId)}
    >
      Rechnung löschen
    </ConfirmDialog>
  );
}
