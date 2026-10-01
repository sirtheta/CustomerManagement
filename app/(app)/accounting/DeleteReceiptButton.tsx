"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteExpenseReceipt } from "./actions";

export default function DeleteReceiptButton({ receiptId }: { receiptId: number }) {
  return (
    <ConfirmDialog
      title="Beleg löschen"
      description="Soll dieser Beleg wirklich gelöscht werden?"
      confirmLabel="Löschen"
      triggerSize="sm"
      onConfirm={() => deleteExpenseReceipt(receiptId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
