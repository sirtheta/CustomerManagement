"use client";

import { useActionState, useMemo, useState } from "react";
import type { Unit } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActionToast } from "@/hooks/use-action-toast";
import { formatCurrency } from "@/lib/utils";
import { billingTotal, buildBillingLines, type BillableService } from "@/lib/work-billing";
import { UNIT_SHORT_LABELS, formatQuantity } from "@/lib/work-entries";
import { deleteWorkEntry } from "../../actions";
import { createInvoiceFromEntries } from "../../billing-actions";
import { EditDialog } from "../../WorkEntryList";

type Entry = {
  id: number;
  date: string; // YYYY-MM-DD
  serviceId: number | null;
  name: string;
  unit: Unit;
  quantity: number;
  note: string | null;
};

type Props = {
  customerId: number;
  canBill: boolean;
  roundTo5Rappen: boolean;
  services: Record<number, BillableService>;
  entries: Entry[];
};

function formatDay(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export default function BillForm({ customerId, canBill, roundTo5Rappen, services, entries }: Props) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(entries.map((e) => e.id)));
  const [state, formAction, isPending] = useActionState(createInvoiceFromEntries.bind(null, customerId), {});
  // A successful billing redirects, so only errors arrive here; they are shown inline below the button.
  useActionToast(state, "Gespeichert", { toastErrors: false });

  const chosen = useMemo(() => entries.filter((e) => selected.has(e.id)), [entries, selected]);
  const lines = useMemo(() => buildBillingLines(chosen, services), [chosen, services]);
  const total = billingTotal(lines, { roundTo5Rappen });

  function toggle(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      {chosen.map((e) => (
        <input key={e.id} type="hidden" name="entryId" value={e.id} />
      ))}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Einträge</h2>
        {/* Phones: one card per entry, the five-column table is too wide for them. */}
        <ul className="space-y-2 lg:hidden">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={(ev) => toggle(e.id, ev.target.checked)}
                  aria-label={`${e.name} vom ${formatDay(e.date)} verrechnen`}
                  className="mt-0.5 size-6 shrink-0 rounded border-input accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-base font-semibold">{e.name}</span>
                    <span className="shrink-0 font-semibold">
                      {formatQuantity(e.quantity)} {UNIT_SHORT_LABELS[e.unit]}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">{formatDay(e.date)}</div>
                  {e.note && <p className="mt-1 text-sm text-muted-foreground">{e.note}</p>}
                </div>
              </div>
              <div className="mt-2 flex justify-end gap-1">
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
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Datum</TableHead>
                <TableHead>Leistung</TableHead>
                <TableHead className="text-right">Menge</TableHead>
                <TableHead>Notiz</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={(ev) => toggle(e.id, ev.target.checked)}
                      aria-label={`${e.name} vom ${formatDay(e.date)} verrechnen`}
                      className="size-4 rounded border-input accent-primary"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(e.date)}</TableCell>
                  <TableCell>{e.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {formatQuantity(e.quantity)} {UNIT_SHORT_LABELS[e.unit]}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.note}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Vorschau der Rechnungspositionen</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Einträge ausgewählt.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">Menge</TableHead>
                  <TableHead className="text-right">Preis</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.key}>
                    <TableCell>
                      <div className="font-medium">{l.name}</div>
                      <div className="whitespace-pre-line text-xs text-muted-foreground">{l.description}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatQuantity(l.quantity)} {UNIT_SHORT_LABELS[l.unit]}
                    </TableCell>
                    <TableCell className="text-right">
                      {l.priceMissing ? <Badge variant="destructive">Preis im Entwurf ergänzen</Badge> : formatCurrency(l.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(l.totalAmount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">
                    Total{roundTo5Rappen ? " (auf 5 Rappen gerundet)" : ""}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Room for the fixed bar below, only on phones. */}
      <div className="h-28 lg:hidden" aria-hidden="true" />
      {/* Phones: pinned above the tab bar with the total; from lg on it is a plain button. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 border-t bg-card px-4 py-3 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto w-full max-w-xl space-y-2 lg:mx-0 lg:max-w-none">
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="flex items-baseline justify-between lg:hidden">
            <span className="text-sm text-muted-foreground">Total{roundTo5Rappen ? " (gerundet)" : ""}</span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
          </div>
          <Button type="submit" className="h-12 w-full text-base lg:h-11 lg:w-auto" disabled={!canBill || chosen.length === 0 || isPending}>
            {isPending ? "Erstellt…" : "Rechnungsentwurf erstellen"}
          </Button>
        </div>
      </div>
    </form>
  );
}
