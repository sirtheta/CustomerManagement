"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteExpense } from "./actions";

type Props = {
  expenseId: number;
  size?: "sm" | "default";
};

export default function DeleteExpenseButton({ expenseId, size = "default" }: Props) {
  return (
    <ConfirmDialog
      title="Ausgabe löschen"
      description="Soll diese Ausgabe wirklich gelöscht werden?"
      confirmLabel="Löschen"
      triggerSize={size}
      onConfirm={() => deleteExpense(expenseId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
