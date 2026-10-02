"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ExpenseHint, OpenTransaction } from "@/lib/import/bank-import";
import { bookExpenses, ignoreTransactions } from "./actions";

type Row = { transaction: OpenTransaction; hint: ExpenseHint };
type Category = { categoryId: number; name: string };
type Selection = { checked: boolean; categoryId: number | null };

const NO_CATEGORY = "none";

export function ExpensesTable({ rows, categories }: { rows: Row[]; categories: Category[] }) {
  // User overrides only: rows without an entry show their hint-based default,
  // so the table keeps its state when rows are added or removed around it.
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Keine offenen Abbuchungen.</p>;
  }

  const visible = rows.filter((row) => !row.hint.previouslyIgnored);
  const previouslyIgnored = rows.filter((row) => row.hint.previouslyIgnored);
  const selectionOf = ({ transaction, hint }: Row): Selection =>
    selections[transaction.id] ?? { checked: hint.preselect, categoryId: hint.categoryId };
  const chosen = rows.filter((row) => selectionOf(row).checked);
  const unticked = visible.filter((row) => !selectionOf(row).checked);

  function update(row: Row, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [row.transaction.id]: { ...selectionOf(row), ...patch },
    }));
  }

  function take() {
    startTransition(async () => {
      try {
        const result = await bookExpenses(
          chosen.map((row) => ({
            transactionId: row.transaction.id,
            categoryId: selectionOf(row).categoryId,
          }))
        );
        if (result.error) toast.error(result.error);
        else {
          const count = result.expenseCount ?? 0;
          toast.success(`${count} Ausgabe${count === 1 ? "" : "n"} übernommen.`);
        }
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  /** Sent in chunks: one call accepts at most 1000 ids. */
  async function ignoreUnticked(): Promise<{ error?: string }> {
    const ids = unticked.map((row) => row.transaction.id);
    let ignoredCount = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const result = await ignoreTransactions(ids.slice(i, i + 1000));
      if (result.error) return { error: result.error };
      ignoredCount += result.ignoredCount ?? 0;
    }
    toast.success(`${ignoredCount} Abbuchung${ignoredCount === 1 ? "" : "en"} ignoriert.`);
    return {};
  }

  function ignoreOne(id: number) {
    startTransition(async () => {
      try {
        const result = await ignoreTransactions([id]);
        if (result.error) toast.error(result.error);
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  function renderRow(row: Row) {
    const { transaction } = row;
    const selection = selectionOf(row);
    const label = transaction.counterparty ?? transaction.description;
    return (
      <TableRow key={transaction.id}>
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            aria-label={`${label} auswählen`}
            checked={selection.checked}
            onChange={(e) => update(row, { checked: e.target.checked })}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">{formatDate(transaction.date)}</TableCell>
        <TableCell className="max-w-xs truncate" title={transaction.description}>
          {transaction.counterparty && <span className="font-medium">{transaction.counterparty} · </span>}
          {transaction.description}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatCurrency(Math.abs(transaction.amountCents) / 100)}
        </TableCell>
        <TableCell>
          <Select
            value={selection.categoryId ? String(selection.categoryId) : NO_CATEGORY}
            onValueChange={(value) =>
              update(row, { categoryId: !value || value === NO_CATEGORY ? null : Number(value) })
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Kategorie">
                {(value: string | null) =>
                  !value || value === NO_CATEGORY
                    ? "Ohne Kategorie"
                    : (categories.find((c) => String(c.categoryId) === value)?.name ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>Ohne Kategorie</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.categoryId} value={String(category.categoryId)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            aria-label={`${label} ignorieren`}
            onClick={() => ignoreOne(transaction.id)}
          >
            Ignorieren
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  const header = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10"></TableHead>
        <TableHead>Datum</TableHead>
        <TableHead>Empfänger</TableHead>
        <TableHead>Betrag</TableHead>
        <TableHead>Kategorie</TableHead>
        <TableHead className="w-24"></TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="space-y-3">
      {visible.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            {header}
            <TableBody>{visible.map(renderRow)}</TableBody>
          </Table>
        </div>
      )}

      {previouslyIgnored.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Bisher ignoriert ({previouslyIgnored.length})
          </summary>
          <div className="overflow-x-auto mt-2 opacity-70">
            <Table>
              {header}
              <TableBody>{previouslyIgnored.map(renderRow)}</TableBody>
            </Table>
          </div>
        </details>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <ConfirmDialog
          title="Nicht angekreuzte Abbuchungen ignorieren"
          description={`${unticked.length} ${unticked.length === 1 ? "Abbuchung wird" : "Abbuchungen werden"} als ignoriert markiert und nicht als Ausgabe übernommen. Das lässt sich nur zurücknehmen, indem der ganze Import rückgängig gemacht wird.`}
          confirmLabel={`${unticked.length} ignorieren`}
          confirmVariant="default"
          triggerVariant="outline"
          triggerDisabled={isPending || unticked.length === 0}
          onConfirm={ignoreUnticked}
        >
          Nicht angekreuzte ignorieren ({unticked.length})
        </ConfirmDialog>
        <Button onClick={take} disabled={isPending || chosen.length === 0}>
          {chosen.length} als Ausgabe{chosen.length === 1 ? "" : "n"} übernehmen
        </Button>
      </div>
    </div>
  );
}
