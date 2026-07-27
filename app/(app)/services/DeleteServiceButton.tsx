"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteService } from "./actions";

type Props = {
  serviceId: number;
  size?: "sm" | "default";
};

export default function DeleteServiceButton({ serviceId, size = "default" }: Props) {
  return (
    <ConfirmDialog
      title="Leistung löschen"
      description="Soll diese Leistung wirklich gelöscht werden?"
      confirmLabel="Löschen"
      triggerSize={size}
      onConfirm={() => deleteService(serviceId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
