"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteCustomer } from "./actions";

type Props = {
  customerId: number;
  size?: "sm" | "default";
};

export default function DeleteCustomerButton({ customerId, size = "default" }: Props) {
  return (
    <ConfirmDialog
      title="Kunde löschen"
      description="Soll dieser Kunde wirklich gelöscht werden? Kunden mit Rechnungen können nicht gelöscht, sondern nur archiviert werden."
      confirmLabel="Löschen"
      triggerSize={size}
      onConfirm={() => deleteCustomer(customerId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
