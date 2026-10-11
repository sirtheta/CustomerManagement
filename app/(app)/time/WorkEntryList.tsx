"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import type { Unit } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UNIT_SHORT_LABELS, formatQuantity } from "@/lib/work-entries";
import { deleteWorkEntry, updateWorkEntry } from "./actions";

export type ListEntry = { id: number; date: string; name: string; unit: Unit; quantity: number; note: string | null };

function formatDay(value: string) {
  const [, month, day] = value.split("-");
  return `${day}.${month}.`;
}

/** Edit dialog for one open entry; the billing page uses it too. */
export function EditDialog({ entry }: { entry: ListEntry }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // No form action on purpose: React 19 would reset the fields after an error. The dialog closes on
  // success only (not in an effect, which the react-hooks/set-state-in-effect rule forbids).
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateWorkEntry(entry.id, {}, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Gespeichert");
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" type="button" />}>Bearbeiten</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry.name} bearbeiten</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`edit-date-${entry.id}`}>Datum</Label>
            <Input id={`edit-date-${entry.id}`} name="date" type="date" defaultValue={entry.date} required className="h-11 text-base" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-quantity-${entry.id}`}>Menge ({UNIT_SHORT_LABELS[entry.unit]})</Label>
            <Input
              id={`edit-quantity-${entry.id}`}
              name="quantity"
              inputMode="decimal"
              defaultValue={formatQuantity(entry.quantity)}
              required
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-note-${entry.id}`}>Notiz (nur intern)</Label>
            <Textarea id={`edit-note-${entry.id}`} name="note" defaultValue={entry.note ?? ""} rows={2} maxLength={500} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Speichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkEntryList({ entries }: { entries: ListEntry[] }) {
  return (
    <section className="space-y-2" aria-labelledby="work-entry-list-title">
      <h2 id="work-entry-list-title" className="text-base font-semibold">
        Erfasst, noch nicht verrechnet
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine offenen Einträge für diesen Kunden.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {formatDay(e.date)} · {e.name} · {formatQuantity(e.quantity)} {UNIT_SHORT_LABELS[e.unit]}
                </p>
                {e.note && <p className="truncate text-muted-foreground">{e.note}</p>}
              </div>
              <EditDialog entry={e} />
              <ConfirmDialog
                title="Eintrag löschen"
                description="Soll dieser Eintrag wirklich gelöscht werden?"
                confirmLabel="Löschen"
                triggerVariant="ghost"
                triggerSize="sm"
                onConfirm={() => deleteWorkEntry(e.id)}
              >
                Löschen
              </ConfirmDialog>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
