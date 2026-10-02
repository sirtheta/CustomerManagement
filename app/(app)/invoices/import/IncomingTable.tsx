"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toRappen } from "@/lib/calculations";
import type { MatchConfidence, MatchedTransaction } from "@/lib/import/matching";
import type { OpenTransaction } from "@/lib/import/bank-import";
import type { ImportOverview } from "@/lib/import/queries";
import { bookPayments, ignoreTransactions, reopenTransactions } from "./actions";
import { InvoicePicker, invoiceLabel, type PickableInvoice } from "./InvoicePicker";

const confidenceLabels: Record<MatchConfidence, string> = {
  reference: "Nummer und Betrag passen",
  amount: "Vorschlag: nur Betrag oder Nummer passt – bitte prüfen",
  name: "Vorschlag: nur der Kundenname passt – bitte prüfen",
  none: "Kein Treffer – offene Rechnung suchen",
};

/** Select value that switches a row from the suggestions to the search over all open invoices. */
const SEARCH_ALL = "search";

type Row = MatchedTransaction<OpenTransaction>;
type Selection = { checked: boolean; invoiceId: number | null; manual: boolean };

/** What a row shows until the user changes it. Name-only matches force an explicit choice. */
function defaultFor(row: Row): Selection {
  return {
    checked: row.confidence === "reference",
    invoiceId:
      row.preselectedInvoiceId ??
      (row.confidence === "name" ? null : (row.candidates[0]?.invoiceId ?? null)),
    manual: row.candidates.length === 0,
  };
}

/** Whether the entry pays the chosen invoice off, only partly, or more than is open. */
function amountHint(amountCents: number, invoice: PickableInvoice | undefined) {
  if (!invoice) return null;
  const openRappen = toRappen(invoice.openAmount);
  if (amountCents < openRappen) {
    return {
      partial: true,
      text: `Teilzahlung: danach bleiben ${formatCurrency((openRappen - amountCents) / 100)} offen`,
    };
  }
  if (amountCents > openRappen) {
    return {
      partial: false,
      text: `${formatCurrency((amountCents - openRappen) / 100)} mehr als offen (z. B. Mahngebühr oder Überzahlung)`,
    };
  }
  return { partial: false, text: "Deckt den offenen Betrag" };
}

export function IncomingTable({
  rows,
  openInvoices,
  ignored,
}: {
  rows: Row[];
  openInvoices: PickableInvoice[];
  ignored: ImportOverview["ignoredIncoming"];
}) {
  // User overrides only: rows without an entry show their default, so the
  // table can keep its state when rows are added or removed around it.
  const [selections, setSelections] = useState<Record<number, Selection>>({});
  const [isPending, startTransition] = useTransition();
  const invoiceById = new Map(openInvoices.map((invoice) => [invoice.id, invoice]));

  const selectionOf = (row: Row): Selection => selections[row.transaction.id] ?? defaultFor(row);

  function update(row: Row, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [row.transaction.id]: { ...(prev[row.transaction.id] ?? defaultFor(row)), ...patch },
    }));
  }

  const chosen = rows.filter((row) => {
    const s = selectionOf(row);
    return s.checked && s.invoiceId !== null;
  });
  const partialCount = chosen.filter(
    (row) => amountHint(row.transaction.amountCents, invoiceById.get(selectionOf(row).invoiceId as number))?.partial
  ).length;

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
        else {
          const count = result.paidCount ?? 0;
          toast.success(`${count} Zahlung${count === 1 ? "" : "en"} verbucht.`);
        }
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  function reopen(id: number) {
    startTransition(async () => {
      try {
        const result = await reopenTransactions([id]);
        if (result.error) toast.error(result.error);
        else if (result.reopenedCount) toast.success("Eingang wieder geöffnet.");
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
        else if (result.ignoredCount) {
          toast.success("Eingang ignoriert.", {
            description: "Er steht unten unter «Ignoriert» und lässt sich dort wieder öffnen.",
            action: { label: "Rückgängig", onClick: () => reopen(id) },
          });
        }
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  function renderAssignment(row: Row) {
    const { transaction, candidates, confidence } = row;
    const selection = selectionOf(row);
    const label = transaction.counterparty ?? transaction.description;
    const hint = amountHint(transaction.amountCents, invoiceById.get(selection.invoiceId ?? -1));

    return (
      <div className="space-y-0.5">
        {selection.manual ? (
          <InvoicePicker
            invoices={openInvoices}
            value={selection.invoiceId}
            ariaLabel={`Rechnung für ${label} suchen`}
            onChange={(invoiceId) => update(row, { invoiceId, checked: invoiceId !== null })}
          />
        ) : (
          <Select
            // null, never undefined: undefined would make the Select uncontrolled
            // until an invoice is chosen (React/Base UI warning on the switch).
            value={selection.invoiceId ? String(selection.invoiceId) : null}
            onValueChange={(value) => {
              if (!value) return;
              if (value === SEARCH_ALL) update(row, { manual: true, invoiceId: null, checked: false });
              else update(row, { invoiceId: Number(value) });
            }}
          >
            <SelectTrigger className="w-72 max-w-full" aria-label={`Rechnung für ${label}`}>
              <SelectValue placeholder="Rechnung wählen" className="min-w-0">
                {(value: string | null) => {
                  const invoice = value ? invoiceById.get(Number(value)) : undefined;
                  const text = invoice ? invoiceLabel(invoice) : "Rechnung wählen";
                  return (
                    <span className="block min-w-0 truncate" title={invoice ? text : undefined}>
                      {text}
                    </span>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => {
                const invoice = invoiceById.get(candidate.invoiceId);
                return (
                  <SelectItem key={candidate.invoiceId} value={String(candidate.invoiceId)}>
                    <span className="min-w-0 flex-1 truncate">
                      {invoice ? invoiceLabel(invoice) : candidate.documentNumber}
                    </span>
                    {invoice && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        offen {formatCurrency(invoice.openAmount)}
                      </span>
                    )}
                  </SelectItem>
                );
              })}
              <SelectItem value={SEARCH_ALL}>Andere offene Rechnung suchen…</SelectItem>
            </SelectContent>
          </Select>
        )}
        {selection.manual && candidates.length > 0 && (
          <button
            type="button"
            className="block text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => update(row, defaultFor(row))}
          >
            Zurück zu den Vorschlägen
          </button>
        )}
        {(selection.manual ? candidates.length === 0 : confidence !== "reference") && (
          <span className="block text-xs text-muted-foreground">{confidenceLabels[confidence]}</span>
        )}
        {hint && (
          <span className={`block text-xs ${hint.partial ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {hint.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Keine offenen Zahlungseingänge.</p>
      ) : (
        <>
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
                  const { transaction } = row;
                  const selection = selectionOf(row);
                  const label = transaction.counterparty ?? transaction.description;
                  return (
                    <TableRow key={transaction.id}>
                      <TableCell className="align-top">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input accent-primary"
                          aria-label={`${label} auswählen`}
                          checked={selection.checked && selection.invoiceId !== null}
                          disabled={selection.invoiceId === null}
                          onChange={(e) => update(row, { checked: e.target.checked })}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap align-top">{formatDate(transaction.date)}</TableCell>
                      <TableCell className="max-w-xs truncate align-top" title={transaction.description}>
                        {transaction.description}
                        {transaction.counterparty && (
                          <span className="text-muted-foreground"> · {transaction.counterparty}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap align-top">
                        {formatCurrency(transaction.amountCents / 100)}
                      </TableCell>
                      <TableCell className="align-top">{renderAssignment(row)}</TableCell>
                      <TableCell className="align-top">
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
            Angekreuzt wird ein Eingang nur, wenn Rechnungsnummer und Betrag zusammenpassen; Leerzeichen
            oder ein fehlendes Präfix in der Nummer stören dabei nicht. Passt nur der Betrag, die Nummer
            oder der Kundenname, wird die Rechnung vorgeschlagen, aber nicht angekreuzt. Ohne Treffer
            kannst du eine offene Rechnung nach Nummer oder Kunde suchen. Wurde die Zahlung schon auf
            anderem Weg erfasst (von Hand oder automatisch übermittelt), ignoriere den Eingang hier.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={confirm} disabled={isPending || chosen.length === 0}>
              {isPending
                ? "Wird gespeichert…"
                : chosen.length === 1 && partialCount === 1
                  ? "1 Teilzahlung verbuchen"
                  : `${chosen.length} Zahlung${chosen.length === 1 ? "" : "en"} verbuchen${
                      partialCount > 0
                        ? ` (davon ${partialCount} Teilzahlung${partialCount === 1 ? "" : "en"})`
                        : ""
                    }`}
            </Button>
          </div>
        </>
      )}

      {ignored.total > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Ignoriert ({ignored.total})</summary>
          <div className="overflow-x-auto mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Beschreibung</TableHead>
                  <TableHead>Betrag</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ignored.rows.map((transaction) => {
                  const label = transaction.counterparty ?? transaction.description;
                  return (
                    <TableRow key={transaction.id} className="text-muted-foreground">
                      <TableCell className="whitespace-nowrap">{formatDate(transaction.date)}</TableCell>
                      <TableCell className="max-w-xs truncate" title={transaction.description}>
                        {transaction.description}
                        {transaction.counterparty && <span> · {transaction.counterparty}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatCurrency(transaction.amountCents / 100)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          aria-label={`${label} wieder öffnen`}
                          onClick={() => reopen(transaction.id)}
                        >
                          Wieder öffnen
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {ignored.total > ignored.rows.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              Angezeigt werden die neuesten {ignored.rows.length} von {ignored.total} ignorierten Eingängen.
            </p>
          )}
        </details>
      )}
    </div>
  );
}
