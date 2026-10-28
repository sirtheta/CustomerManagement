"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveSubscriptionNote } from "@/lib/customer-archive";
import { archiveCustomer, deleteCustomer } from "./actions";

type Props = {
  customerId: number;
  size?: "sm" | "default";
  hasInvoices?: boolean;
  hasWorkEntries?: boolean;
  archived?: boolean;
  activeSubscriptions?: number;
};

export default function DeleteCustomerButton({
  customerId,
  size = "default",
  hasInvoices = false,
  hasWorkEntries = false,
  archived = false,
  activeSubscriptions = 0,
}: Props) {
  if (hasInvoices || hasWorkEntries) {
    // Invoices and recorded work are kept, so the customer cannot be deleted: offer archiving instead.
    if (archived) return null;
    const kept = hasInvoices ? "Rechnungen" : "erfasste Leistungen";
    return (
      <ConfirmDialog
        title="Kunde archivieren?"
        description={`Dieser Kunde hat ${kept} und kann nicht gelöscht werden. Soll er stattdessen archiviert werden? Rechnungen und Daten bleiben erhalten, der Kunde kann im Archiv wiederhergestellt werden. ${archiveSubscriptionNote(activeSubscriptions)}`.trim()}
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
      onConfirm={() => deleteCustomer(customerId, archived)}
    >
      Löschen
    </ConfirmDialog>
  );
}
