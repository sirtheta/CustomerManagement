"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveSubscriptionNote } from "@/lib/customer-archive";
import { archiveCustomer, restoreCustomer } from "./actions";

type Props = { customerId: number; archived: boolean; activeSubscriptions?: number };

export default function ArchiveCustomerButton({ customerId, archived, activeSubscriptions = 0 }: Props) {
  const [isPending, startTransition] = useTransition();

  if (archived) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreCustomer(customerId);
            if (res.error) toast.error(res.error);
          })
        }
      >
        Wiederherstellen
      </Button>
    );
  }

  return (
    <ConfirmDialog
      title="Kunde archivieren"
      description={`Der Kunde erscheint nicht mehr in der Kundenliste und in Auswahllisten. Rechnungen und Daten bleiben erhalten. Du kannst ihn im Archiv wiederherstellen. ${archiveSubscriptionNote(activeSubscriptions)}`.trim()}
      confirmLabel="Archivieren"
      confirmVariant="default"
      triggerVariant="outline"
      triggerSize="sm"
      onConfirm={() => archiveCustomer(customerId)}
    >
      Archivieren
    </ConfirmDialog>
  );
}
