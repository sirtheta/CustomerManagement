"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteService } from "./actions";

type Props = {
  serviceId: number;
  size?: "sm" | "default";
  /** Open time entries that lose their catalog price when the service is deleted. */
  openWorkEntries?: number;
};

export default function DeleteServiceButton({ serviceId, size = "default", openWorkEntries = 0 }: Props) {
  return (
    <ConfirmDialog
      title="Leistung löschen"
      description={
        openWorkEntries > 0
          ? `Soll diese Leistung wirklich gelöscht werden? ${openWorkEntries} offene Erfassung${openWorkEntries === 1 ? "" : "en"} verlieren dabei den Preis aus dem Katalog und werden mit Preis 0 verrechnet.`
          : "Soll diese Leistung wirklich gelöscht werden?"
      }
      confirmLabel="Löschen"
      triggerSize={size}
      onConfirm={() => deleteService(serviceId)}
    >
      Löschen
    </ConfirmDialog>
  );
}
