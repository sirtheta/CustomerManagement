"use client";

import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateQuoteStatus } from "./actions";
import type { QuoteState } from "@prisma/client";

const stateOptions: { value: QuoteState; label: string }[] = [
  { value: "Draft", label: "Entwurf" },
  { value: "Sent", label: "Versendet" },
  { value: "Accepted", label: "Angenommen" },
  { value: "Declined", label: "Abgelehnt" },
  { value: "Expired", label: "Abgelaufen" },
];

type Props = {
  quoteId: number;
  currentState: QuoteState;
};

export default function QuoteStatusSelect({ quoteId, currentState }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    if (!value) return;
    startTransition(async () => {
      await updateQuoteStatus(quoteId, value as QuoteState);
    });
  }

  return (
    <Select defaultValue={currentState} onValueChange={handleChange} disabled={isPending}>
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
