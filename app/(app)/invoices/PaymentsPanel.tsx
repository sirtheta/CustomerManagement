"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { swissDateString } from "@/lib/date";
import { deletePaymentAction, recordPaymentAction } from "./payments/actions";
import type { InvoiceState } from "@prisma/client";

type Props = {
  invoiceId: number;
  state: InvoiceState;
  canEdit: boolean;
  summary: { total: number; paid: number; remaining: number; overpaid: number };
  payments: { id: number; date: string; amount: number; source: string }[];
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell",
  "camt-import": "Bankimport",
  "budget-import": "Budget-App",
  migration: "Übernommen",
};

export default function PaymentsPanel({ invoiceId, state, canEdit, summary, payments }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const prefill = (remaining: number) => (remaining > 0 ? remaining.toFixed(2) : "");
  const [amount, setAmount] = useState(prefill(summary.remaining));
  // A recorded or deleted payment changes the open amount: prefill the new one (adjusting state while rendering, no effect).
  const [syncedRemaining, setSyncedRemaining] = useState(summary.remaining);
  if (syncedRemaining !== summary.remaining) {
    setSyncedRemaining(summary.remaining);
    setAmount(prefill(summary.remaining));
  }
  const [date, setDate] = useState(() => swissDateString());
  const [overpaidBy, setOverpaidBy] = useState<number | null>(null);
  // Nothing open (paid, overpaid or fully credited): the form stays behind a link.
  const [formRequested, setFormRequested] = useState(false);

  const canPay = canEdit && (state === "Sent" || state === "Overdue" || state === "PartiallyPaid" || state === "Paid");
  const showForm = canPay && (summary.remaining > 0 || formRequested);

  function run(action: () => Promise<{ error?: string; needsConfirmation?: { overpaidBy: number } }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setOverpaidBy(res.needsConfirmation.overpaidBy);
      else setOverpaidBy(null);
    });
  }

  function submit(confirm: boolean) {
    run(() => recordPaymentAction(invoiceId, amount, date, confirm));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>Total: <span className="font-medium">{formatCurrency(summary.total)}</span></div>
        <div>Bezahlt: <span className="font-medium">{formatCurrency(summary.paid)}</span></div>
        {summary.remaining > 0 && (
          <div>Offen: <span className="font-medium">{formatCurrency(summary.remaining)}</span></div>
        )}
        {summary.overpaid > 0 && (
          <Badge variant="secondary">Überzahlt um {formatCurrency(summary.overpaid)}</Badge>
        )}
      </div>

      {payments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Betrag</TableHead>
              <TableHead>Quelle</TableHead>
              {canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.date)}</TableCell>
                <TableCell>{formatCurrency(p.amount)}</TableCell>
                <TableCell>{SOURCE_LABELS[p.source] ?? p.source}</TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm("Zahlung wirklich löschen?")) {
                          run(() => deletePaymentAction(p.id));
                        }
                      }}
                    >
                      Löschen
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canPay && !showForm && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFormRequested(true)}>
          Zahlung trotzdem erfassen
        </Button>
      )}

      {showForm && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="paymentAmount">Betrag (CHF)</Label>
            <Input
              id="paymentAmount"
              inputMode="decimal"
              className="w-36"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setOverpaidBy(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paymentDate">Datum</Label>
            <Input
              id="paymentDate"
              type="date"
              className="w-40"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button disabled={isPending} onClick={() => submit(false)}>
            Zahlung erfassen
          </Button>
        </div>
      )}

      {overpaidBy !== null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
          <p>
            Der Betrag übersteigt den offenen Betrag um {formatCurrency(overpaidBy)}. Trotzdem speichern?
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={isPending} onClick={() => submit(true)}>Ja, speichern</Button>
            <Button size="sm" variant="outline" onClick={() => setOverpaidBy(null)}>Abbrechen</Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
