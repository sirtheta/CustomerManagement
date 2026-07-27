"use client";

import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateInvoicePaidDate } from "./actions";

type Props = {
  invoiceId: number;
  paidDate: string | null;
};

function toInputValue(paidDate: string | null): string {
  return paidDate ? paidDate.slice(0, 10) : "";
}

export default function PaidDateField({ invoiceId, paidDate }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    if (!value) return;
    startTransition(async () => {
      await updateInvoicePaidDate(invoiceId, value);
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="paidDate">Bezahldatum</Label>
      <Input
        id="paidDate"
        type="date"
        className="w-40"
        defaultValue={toInputValue(paidDate)}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
