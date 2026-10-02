"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteSubscription, setSubscriptionActive } from "../customers/subscription-actions";

type Props = {
  customerId: number;
  subscriptionId: number;
  active: boolean;
};

export default function SubscriptionRowActions({ customerId, subscriptionId, active }: Props) {
  const [isToggling, startToggle] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isToggling}
        onClick={() =>
          startToggle(async () => {
            try {
              await setSubscriptionActive(customerId, subscriptionId, !active);
            } catch {
              toast.error("Status konnte nicht geändert werden.");
            }
          })
        }
      >
        {active ? "Pausieren" : "Fortsetzen"}
      </Button>
      <ConfirmDialog
        title="Abo löschen"
        description="Soll dieses Abo wirklich gelöscht werden? Bereits erstellte Rechnungen bleiben erhalten."
        confirmLabel="Löschen"
        triggerSize="sm"
        onConfirm={() => deleteSubscription(customerId, subscriptionId)}
      >
        Löschen
      </ConfirmDialog>
    </div>
  );
}
