"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveSubscriptionNote } from "@/lib/customer-archive";
import { archiveCustomer, deleteCustomer } from "./actions";

type Props = {
  customerId: number;
  size?: "sm" | "default";
  hasInvoices?: boolean;
  archived?: boolean;
  activeSubscriptions?: number;
};

export default function DeleteCustomerButton({
  customerId,
  size = "default",
  hasInvoices = false,
  archived = false,
  activeSubscriptions = 0,
}: Props) {
  if (hasInvoices) {
    // Invoices are booking records, so the customer cannot be deleted: offer archiving instead.
    if (archived) return null;
    return (
      <ConfirmDialog
        title="Kunde archivieren?"
        description={`Dieser Kunde hat Rechnungen und kann nicht gelöscht werden. Soll er stattdessen archiviert werden? Rechnungen und Daten bleiben erhalten, der Kunde kann im Archiv wiederhergestellt werden. ${archiveSubscriptionNote(activeSubscriptions)}`.trim()}
        confirmLabel="Archivieren"
        confirmVariant="default"
        triggerSize={size}
        onConfirm={() => archiveCustomer(customerId)}
      >
        Löschen
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      title="Kunde löschen"
      description="Soll dieser Kunde wirklich gelöscht werden?"
      confirmLabel="Löschen"
      triggerSize={size}
      onConfirm={() => deleteCustomer(customerId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
