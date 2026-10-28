"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { deleteUser } from "./actions";

type User = { id: number; name: string };

export function DeleteUserDialog({ user }: { user: User }) {
  return (
    <ConfirmDialog
      title={`Benutzer löschen: ${user.name}`}
      description={`Soll der Benutzer «${user.name}» wirklich gelöscht werden?`}
      confirmLabel="Löschen"
      triggerSize="sm"
      onConfirm={async () => {
        const result = await deleteUser(user.id);
        if (!result.error) toast.success("Benutzer gelöscht");
        return result;
      }}
    >
      Löschen
    </ConfirmDialog>
  );
}
