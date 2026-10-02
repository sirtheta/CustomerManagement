"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteTemplate } from "./actions";
import { Trash2 } from "lucide-react";

export default function DeleteTemplateButton({ templateId }: { templateId: number }) {
  return (
    <ConfirmDialog
      title="Vorlage löschen"
      description="Soll diese Vorlage wirklich gelöscht werden? Abos, die sie verwenden, haben danach keine Vorlage mehr."
      confirmLabel="Löschen"
      triggerVariant="ghost"
      triggerSize="icon-sm"
      triggerClassName="text-destructive hover:text-destructive hover:bg-destructive/10"
      triggerAriaLabel="Vorlage löschen"
      onConfirm={() => deleteTemplate(templateId)}
    >
      <Trash2 />
    </ConfirmDialog>
  );
}
