"use client";

import { useOptimistic, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateInvoiceStatus } from "./actions";
import { allowedInvoiceTargets } from "@/lib/state-manager";
import type { InvoiceState } from "@prisma/client";

const stateOptions: { value: InvoiceState; label: string }[] = [
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "PartiallyPaid", label: "Teilbezahlt" },
  { value: "Paid", label: "Bezahlt" },
  { value: "Overdue", label: "Überfällig" },
  { value: "Canceled", label: "Storniert" },
];

type Props = {
  invoiceId: number;
  currentState: InvoiceState;
};

export default function InvoiceStatusSelect({ invoiceId, currentState }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useOptimistic(currentState);

  function handleChange(value: string | null) {
    if (!value) return;
    startTransition(async () => {
      setOptimisticState(value as InvoiceState);
      const res = await updateInvoiceStatus(invoiceId, value as InvoiceState);
      if (res.error) toast.error(res.error);
    });
  }

  const locked = currentState === "Paid" || currentState === "PartiallyPaid";

  return (
    <div className="space-y-1">
      <Select value={optimisticState} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-40">
          <SelectValue>
            {(value: string | null) =>
              value ? (stateOptions.find((o) => o.value === value)?.label ?? value) : "Status wählen"
            }
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
    </div>
  );
}
