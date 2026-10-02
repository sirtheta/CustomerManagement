"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { updateInvoiceStatus } from "./actions";
import { allowedInvoiceTargets, locksDraftWithoutMail } from "@/lib/state-manager";
import type { InvoiceState } from "@prisma/client";
import { useSendDialog } from "./SendDialogContext";

const stateOptions: { value: InvoiceState; label: string }[] = [
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "PartiallyPaid", label: "Teilbezahlt" },
  { value: "Paid", label: "Bezahlt" },
  { value: "Overdue", label: "Überfällig" },
  { value: "Canceled", label: "Storniert" },
];

const labelOf = (state: InvoiceState) => stateOptions.find((o) => o.value === state)?.label ?? state;

type Props = {
  invoiceId: number;
  currentState: InvoiceState;
  /** For drafts: the number the next numbering would assign, shown in the confirmation. */
  nextDocumentNumber?: string | null;
};

export default function InvoiceStatusSelect({ invoiceId, currentState, nextDocumentNumber }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useOptimistic(currentState);
  // Target waiting for confirmation (a draft would be numbered and locked without a mail).
  const [confirmTarget, setConfirmTarget] = useState<InvoiceState | null>(null);
  const sendDialog = useSendDialog();

  function applyChange(target: InvoiceState) {
    startTransition(async () => {
      setOptimisticState(target);
      const res = await updateInvoiceStatus(invoiceId, target);
      if (res.error) toast.error(res.error);
    });
  }

  function handleChange(value: string | null) {
    if (!value) return;
    const target = value as InvoiceState;
    if (locksDraftWithoutMail(currentState, target)) {
      setConfirmTarget(target);
      return;
    }
    applyChange(target);
  }

  function confirmMark() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    applyChange(target);
  }

  function sendInstead() {
    setConfirmTarget(null);
    sendDialog?.setOpen(true);
  }

  const locked = currentState === "Paid" || currentState === "PartiallyPaid";
  const numberText = nextDocumentNumber ? `die Nummer ${nextDocumentNumber}` : "eine Rechnungsnummer";

  return (
    <div className="space-y-1">
      <Select value={optimisticState} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-40">
          <SelectValue>
            {(value: string | null) => (value ? labelOf(value as InvoiceState) : "Status wählen")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {stateOptions
            .filter((opt) => allowedInvoiceTargets(currentState).includes(opt.value))
            .map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {locked && (
        <p className="text-xs text-muted-foreground">Zum Zurücksetzen die Zahlungen löschen.</p>
      )}

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Ohne Versand als «{confirmTarget ? labelOf(confirmTarget) : ""}» markieren?
            </DialogTitle>
            <DialogDescription>
              Die Rechnung erhält {numberText}, kann danach nicht mehr bearbeitet werden und wird{" "}
              <strong>nicht</strong> per E-Mail versendet.
              {confirmTarget === "Paid" && " Der offene Betrag wird als Zahlung von heute erfasst."} Zum
              Versenden bitte «Senden» verwenden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-wrap">
            <DialogClose render={<Button variant="outline" />}>Abbrechen</DialogClose>
            <Button variant="secondary" onClick={confirmMark}>
              Trotzdem so markieren
            </Button>
            {sendDialog && <Button onClick={sendInstead}>Stattdessen senden</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
