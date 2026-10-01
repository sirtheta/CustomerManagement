"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { MatchConfidence, MatchedTransaction } from "@/lib/import/matching";
import type { OpenTransaction } from "@/lib/import/bank-import";
import { bookPayments, ignoreTransactions } from "./actions";

const confidenceLabels: Record<MatchConfidence, string> = {
  reference: "Referenz gefunden",
  amount: "nur Betrag oder Nummer passt",
  name: "Kundenname passt",
  none: "keine Zuordnung",
};

type Selection = { checked: boolean; invoiceId: number | null };

/** What a row shows until the user changes it. Name-only matches force an explicit choice. */
function defaultFor(row: MatchedTransaction<OpenTransaction>): Selection {
  return {
    checked: row.confidence === "reference",
    invoiceId:
      row.preselectedInvoiceId ??
      (row.confidence === "name" ? null : (row.candidates[0]?.invoiceId ?? null)),
  };
}

export function IncomingTable({ rows }: { rows: MatchedTransaction<OpenTransaction>[] }) {
  // User overrides only: rows without an entry show their default, so the
  // table can keep its state when rows are added or removed around it.
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Keine offenen Zahlungseingänge.</p>;
  }

  const selectionOf = (row: MatchedTransaction<OpenTransaction>): Selection =>
    selections[row.transaction.id] ?? defaultFor(row);

  function update(row: MatchedTransaction<OpenTransaction>, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [row.transaction.id]: { ...(prev[row.transaction.id] ?? defaultFor(row)), ...patch },
    }));
  }

  const chosen = rows.filter((row) => {
    const s = selectionOf(row);
    return s.checked && s.invoiceId !== null;
  });

  function confirm() {
    startTransition(async () => {
      try {
        const result = await bookPayments(
          chosen.map((row) => ({
            transactionId: row.transaction.id,
            invoiceId: selectionOf(row).invoiceId as number,
          }))
        );
        if (result.error) toast.error(result.error);
        else toast.success(`${result.paidCount ?? 0} Zahlung(en) verbucht.`);
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  function ignore(id: number) {
    startTransition(async () => {
      try {
        const result = await ignoreTransactions([id]);
        if (result.error) toast.error(result.error);
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Datum</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Betrag</TableHead>
              <TableHead>Zuordnung</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const { transaction, candidates, confidence } = row;
              const selection = selectionOf(row);
              const label = transaction.counterparty ?? transaction.description;
              return (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {candidates.length > 0 && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input accent-primary"
                        aria-label={`${label} auswählen`}
                        checked={selection.checked}
                        onChange={(e) => update(row, { checked: e.target.checked })}
                      />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(transaction.date)}</TableCell>
                  <TableCell className="max-w-xs truncate" title={transaction.description}>
                    {transaction.description}
                    {transaction.counterparty && (
                      <span className="text-muted-foreground"> · {transaction.counterparty}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatCurrency(transaction.amountCents / 100)}
                  </TableCell>
                  <TableCell>
                    {candidates.length > 0 ? (
                      <Select
                        value={selection.invoiceId ? String(selection.invoiceId) : undefined}
                        onValueChange={(value) => value && update(row, { invoiceId: Number(value) })}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Rechnung wählen">
                            {(value: string | null) =>
                              value
                                ? (candidates.find((c) => String(c.invoiceId) === value)?.documentNumber ?? value)
                                : "Rechnung wählen"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {candidates.map((candidate) => (
                            <SelectItem key={candidate.invoiceId} value={String(candidate.invoiceId)}>
                              {candidate.documentNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">{confidenceLabels.none}</span>
                    )}
                    {candidates.length > 0 && confidence !== "reference" && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {confidenceLabels[confidence]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      aria-label={`${label} ignorieren`}
                      onClick={() => ignore(transaction.id)}
                    >
                      Ignorieren
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Eingänge ohne offene Rechnung können nur ignoriert werden. Wurde eine Zahlung schon über die
        Budget-App verbucht, hier ignorieren.
      </p>
      <div className="flex justify-end">
        <Button onClick={confirm} disabled={isPending || chosen.length === 0}>
          {isPending
            ? "Wird gespeichert…"
            : `${chosen.length} Rechnung${chosen.length === 1 ? "" : "en"} als bezahlt markieren`}
        </Button>
      </div>
    </div>
  );
}
