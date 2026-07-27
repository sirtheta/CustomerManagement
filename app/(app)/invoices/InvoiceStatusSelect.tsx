"use client";

import { useOptimistic, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateInvoiceStatus } from "./actions";
import type { InvoiceState } from "@prisma/client";

const stateOptions: { value: InvoiceState; label: string }[] = [
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
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
      await updateInvoiceStatus(invoiceId, value as InvoiceState);
    });
  }

  return (
    <Select value={optimisticState} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-40">
        <SelectValue>
          {(value: string | null) =>
            value ? (stateOptions.find((o) => o.value === value)?.label ?? value) : "Status wählen"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {stateOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
