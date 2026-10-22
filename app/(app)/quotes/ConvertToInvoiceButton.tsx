"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { convertQuoteToInvoice } from "./actions";
import { toast } from "sonner";

type Props = {
  quoteId: number;
  /** Main action of the page (accepted quote that has no invoice yet). */
  primary?: boolean;
  /** An invoice was already created from this quote: a further one needs an explicit confirmation. */
  alreadyConverted?: boolean;
};

export default function ConvertToInvoiceButton({ quoteId, primary = false, alreadyConverted = false }: Props) {
  async function handleConvert() {
    const result = await convertQuoteToInvoice(quoteId, { again: alreadyConverted });
    if (result?.error) {
      toast.error(result.error);
    }
  }

  return (
    <ConfirmDialog
      title={alreadyConverted ? "Weitere Rechnung erstellen?" : "Offerte in Rechnung umwandeln"}
      description={
        alreadyConverted
          ? "Diese Offerte wurde bereits in eine Rechnung umgewandelt. Trotzdem eine weitere Rechnung erstellen?"
          : "Es wird ein Rechnungsentwurf erstellt, die Offerte wird auf «Angenommen» gesetzt. Versendet wird noch nichts."
      }
      confirmLabel={alreadyConverted ? "Weitere Rechnung erstellen" : "In Rechnung umwandeln"}
      confirmVariant="default"
      triggerVariant={primary ? "default" : "outline"}
      onConfirm={handleConvert}
    >
      {alreadyConverted ? "Weitere Rechnung erstellen" : "In Rechnung umwandeln"}
    </ConfirmDialog>
  );
}
