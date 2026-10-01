"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(
      rows.map(({ transaction, hint }) => [
        transaction.id,
        { checked: hint.preselect, categoryId: hint.categoryId },
      ])
    )
  );
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Keine offenen Abbuchungen.</p>;
  }

  const visible = rows.filter((row) => !row.hint.previouslyIgnored);
  const previouslyIgnored = rows.filter((row) => row.hint.previouslyIgnored);
  const chosen = rows.filter((row) => selections[row.transaction.id]?.checked);
  const unticked = visible.filter((row) => !selections[row.transaction.id]?.checked);

  function update(id: number, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { checked: false, categoryId: null }), ...patch },
    }));
  }

  function take() {
    startTransition(async () => {
      const result = await bookExpenses(
        chosen.map((row) => ({
          transactionId: row.transaction.id,
          categoryId: selections[row.transaction.id].categoryId,
        }))
      );
      if (result.error) toast.error(result.error);
      else toast.success(`${result.expenseCount ?? 0} Ausgabe(n) übernommen.`);
    });
  }

  function ignoreUnticked() {
    startTransition(async () => {
      const result = await ignoreTransactions(unticked.map((row) => row.transaction.id));
      if (result.error) toast.error(result.error);
      else toast.success(`${result.ignoredCount ?? 0} Bewegung(en) ignoriert.`);
    });
  }

  function ignoreOne(id: number) {
    startTransition(async () => {
      const result = await ignoreTransactions([id]);
      if (result.error) toast.error(result.error);
    });
  }

  function renderRow({ transaction }: Row) {
    const selection = selections[transaction.id];
    return (
      <TableRow key={transaction.id}>
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={selection?.checked ?? false}
            onChange={(e) => update(transaction.id, { checked: e.target.checked })}
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
            value={selection?.categoryId ? String(selection.categoryId) : NO_CATEGORY}
            onValueChange={(value) =>
              update(transaction.id, { categoryId: !value || value === NO_CATEGORY ? null : Number(value) })
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
          <Button variant="ghost" size="sm" disabled={isPending} onClick={() => ignoreOne(transaction.id)}>
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

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={ignoreUnticked} disabled={isPending || unticked.length === 0}>
          Nicht angekreuzte ignorieren ({unticked.length})
        </Button>
        <Button onClick={take} disabled={isPending || chosen.length === 0}>
          {chosen.length} als Ausgabe{chosen.length === 1 ? "" : "n"} übernehmen
        </Button>
      </div>
    </div>
  );
}
