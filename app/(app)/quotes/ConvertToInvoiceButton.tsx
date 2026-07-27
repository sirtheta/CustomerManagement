"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { convertQuoteToInvoice } from "./actions";
import { toast } from "sonner";

type Props = {
  quoteId: number;
};

export default function ConvertToInvoiceButton({ quoteId }: Props) {
  async function handleConvert() {
    const result = await convertQuoteToInvoice(quoteId);
    if (result?.error) {
      toast.error(result.error);
    }
  }

  return (
    <ConfirmDialog
      title="Offerte konvertieren"
      description="Soll diese Offerte in eine Rechnung umgewandelt werden?"
      confirmLabel="Konvertieren"
      confirmVariant="default"
      triggerVariant="outline"
      onConfirm={handleConvert}
    >
      Zu Rechnung konvertieren
    </ConfirmDialog>
  );
}
