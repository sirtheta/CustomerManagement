"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteTemplate } from "./actions";
import { Trash2 } from "lucide-react";

export default function DeleteTemplateButton({ templateId }: { templateId: number }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Vorlage löschen?")) return;
    startTransition(async () => {
      await deleteTemplate(templateId);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleDelete}
      disabled={isPending}
      className="text-destructive hover:text-destructive hover:bg-destructive/10"
      aria-label="Vorlage löschen"
    >
      <Trash2 />
    </Button>
  );
}
