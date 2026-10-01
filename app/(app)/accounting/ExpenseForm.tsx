"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createExpense, updateExpense, type ExpenseFormState } from "./actions";
import type { Category, Expense } from "@prisma/client";
import DeleteReceiptButton from "./DeleteReceiptButton";

type SerializedExpense = Omit<Expense, "amount" | "date" | "dueDate" | "paidDate"> & {
  amount: number;
  date: string;
  dueDate: string | null;
  paidDate: string | null;
};

export type ReceiptInfo = { id: number; name: string; size: number };

type Props = {
  expense?: SerializedExpense;
  categories: Category[];
  receipts?: ReceiptInfo[];
  canDeleteReceipts?: boolean;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive mt-1" role="alert">
      {message}
    </p>
  );
}

export default function ExpenseForm({ expense, categories, receipts = [], canDeleteReceipts = false }: Props) {
  const action = expense ? updateExpense.bind(null, expense.id) : createExpense;

  const [state, formAction, isPending] = useActionState<ExpenseFormState, FormData>(
    action,
    {}
  );

  const fe = state.fieldErrors ?? {};
  const [paid, setPaid] = useState(expense ? expense.paidDate !== null : true);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {expense ? "Ausgabe bearbeiten" : "Neue Ausgabe"}
        </h1>
        <Button variant="outline" render={<Link href="/accounting" />}>
          Abbrechen
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ausgabendaten</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            {state.error && !state.fieldErrors && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Bezeichnung <span className="text-destructive">*</span>
              </Label>
              <Input
                id="description"
                name="description"
                required
                defaultValue={expense?.description ?? ""}
                placeholder="z.B. Bürozubehör"
                aria-invalid={!!fe.description}
                aria-describedby={fe.description ? "description-error" : undefined}
              />
              <FieldError id="description-error" message={fe.description} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="date">
                  Datum <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  required
                  defaultValue={expense?.date?.slice(0, 10) ?? ""}
                  aria-invalid={!!fe.date}
                  aria-describedby={fe.date ? "date-error" : undefined}
                />
                <FieldError id="date-error" message={fe.date} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">
                  Betrag (CHF) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={expense?.amount ?? ""}
                  placeholder="0.00"
                  aria-invalid={!!fe.amount}
                  aria-describedby={fe.amount ? "amount-error" : undefined}
                />
                <FieldError id="amount-error" message={fe.amount} />
              </div>
            </div>

            {categories.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="categoryId">Kategorie</Label>
                <Select
                  name="categoryId"
                  defaultValue={expense?.categoryId?.toString() ?? ""}
                >
                  <SelectTrigger id="categoryId" className="w-full">
                    <SelectValue placeholder="Keine Kategorie">
                      {(value: string | null) =>
                        value
                          ? (categories.find((c) => c.categoryId.toString() === value)?.name ?? value)
                          : "Keine Kategorie"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Keine Kategorie</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.categoryId} value={cat.categoryId.toString()}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {categories.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Keine Kategorien vorhanden.{" "}
                <Link href="/settings/categories" className="underline">
                  Kategorien verwalten
                </Link>
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="supplier">Lieferant</Label>
              <Input
                id="supplier"
                name="supplier"
                defaultValue={expense?.supplier ?? ""}
                placeholder="z.B. Muster AG"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Fällig am</Label>
                <Input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  defaultValue={expense?.dueDate?.slice(0, 10) ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paidDate">Bezahlt am</Label>
                <Input
                  id="paidDate"
                  name="paidDate"
                  type="date"
                  disabled={!paid}
                  defaultValue={expense?.paidDate?.slice(0, 10) ?? ""}
                />
                <p className="text-xs text-muted-foreground">Leer = Datum der Ausgabe.</p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="paid"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
              />
              Bezahlt (nicht ankreuzen für offene Lieferantenrechnung)
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="receipts">Belege (PDF, JPG, PNG, je max. 5 MB)</Label>
              <Input
                id="receipts"
                name="receipts"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              />
              {receipts.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {receipts.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <a
                        href={`/api/expenses/receipts/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline truncate"
                      >
                        {r.name}
                      </a>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {Math.max(1, Math.round(r.size / 1024))} KB
                        </span>
                        {canDeleteReceipts && <DeleteReceiptButton receiptId={r.id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notiz</Label>
              <textarea
                id="notes"
                name="notes"
                defaultValue={expense?.notes ?? ""}
                rows={3}
                placeholder="Optionale Notiz"
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" render={<Link href="/accounting" />}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Speichern…" : "Speichern"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
