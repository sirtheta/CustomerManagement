"use client";

import { useActionState } from "react";
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

type SerializedExpense = Omit<Expense, "amount" | "date"> & { amount: number; date: string };

type Props = {
  expense?: SerializedExpense;
  categories: Category[];
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive mt-1" role="alert">
      {message}
    </p>
  );
}

export default function ExpenseForm({ expense, categories }: Props) {
  const action = expense ? updateExpense.bind(null, expense.id) : createExpense;

  const [state, formAction, isPending] = useActionState<ExpenseFormState, FormData>(
    action,
    {}
  );

  const fe = state.fieldErrors ?? {};

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
