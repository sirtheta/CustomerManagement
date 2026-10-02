"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { createCreditNote } from "./actions";

type Props = { invoiceId: number; paid?: number; remaining?: number };

export default function CreateCreditNoteButton({ invoiceId, paid = 0, remaining = 0 }: Props) {
  const baseText =
    "Es wird ein Gutschrift-Entwurf mit allen Positionen dieser Rechnung angelegt. Du kannst Positionen streichen oder anpassen, bevor du die Gutschrift versendest.";
  // Payments are never touched by a credit note; what exceeds the open remainder becomes an overpayment.
  const paymentHint =
    paid > 0
      ? ` Auf dieser Rechnung sind bereits ${formatCurrency(paid)} bezahlt (offen: ${formatCurrency(remaining)}). Die Zahlungen bleiben unverändert: Übersteigt die Gutschrift den offenen Betrag, gilt die Rechnung als überzahlt, und eine Rückzahlung musst du selbst veranlassen.`
      : "";
  return (
    <ConfirmDialog
      title="Gutschrift erstellen"
      description={baseText + paymentHint}
      confirmLabel="Gutschrift erstellen"
      confirmVariant="default"
      triggerVariant="outline"
      onConfirm={() => createCreditNote(invoiceId)}
    >
      Gutschrift erstellen
    </ConfirmDialog>
  );
}
