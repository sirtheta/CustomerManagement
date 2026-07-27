"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteQuote } from "./actions";

type Props = {
  quoteId: number;
};

export default function DeleteQuoteButton({ quoteId }: Props) {
  return (
    <ConfirmDialog
      title="Offerte löschen"
      description="Soll diese Offerte wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden."
      confirmLabel="Löschen"
      onConfirm={() => deleteQuote(quoteId)}
    >
      Offerte löschen
    </ConfirmDialog>
  );
}
