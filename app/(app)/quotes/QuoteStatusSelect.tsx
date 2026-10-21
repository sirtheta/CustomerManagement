"use client";

import { useOptimistic, useTransition } from "react";
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
  // Controlled: the server state (e.g. «Versendet» after sending) must show up here too.
  // The optimistic value snaps back to currentState once the transition ends.
  const [shownState, setShownState] = useOptimistic(currentState);

  function handleChange(value: string | null) {
    if (!value) return;
    startTransition(async () => {
      setShownState(value as QuoteState);
      await updateQuoteStatus(quoteId, value as QuoteState);
    });
  }

  return (
    <Select value={shownState} onValueChange={handleChange} disabled={isPending}>
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
