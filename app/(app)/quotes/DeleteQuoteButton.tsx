"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteQuote } from "./actions";

type Props = {
  quoteId: number;
  /** Validated `?from=` of the detail page, so deleting returns there. */
  from?: string | null;
};

export default function DeleteQuoteButton({ quoteId, from }: Props) {
  return (
    <ConfirmDialog
      title="Offerte löschen"
      description="Soll diese Offerte wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden."
      confirmLabel="Löschen"
      onConfirm={() => deleteQuote(quoteId, from)}
    >
      Offerte löschen
    </ConfirmDialog>
  );
}
