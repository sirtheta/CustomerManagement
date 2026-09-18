"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import { parseStatement, type ParseStatementState } from "./actions";
import { markInvoicesPaidFromImport, type ImportMatch } from "../actions";
import type { MatchConfidence } from "@/lib/import/matching";

const confidenceLabels: Record<MatchConfidence, string> = {
  reference: "Referenz gefunden",
  amount: "nur Betrag passt",
  none: "keine Zuordnung",
};

type RowSelection = {
  checked: boolean;
  invoiceId: number | null;
};

export function ImportWizard() {
  const [parseState, parseAction, isParsing] = useActionState<ParseStatementState, FormData>(
    parseStatement,
    {}
  );
  const [selections, setSelections] = useState<Record<number, RowSelection> | null>(null);
  const [selectionsFor, setSelectionsFor] = useState<ParseStatementState["matches"]>(undefined);
  const [isConfirming, startConfirm] = useTransition();
  const router = useRouter();

  const matches = parseState.matches;

  // Row selections are derived from `matches`, but every successful parse
  // produces a new array — re-derive whenever that reference changes rather
  // than only once, or a second upload would render its preview against
  // selections indexed into the previous file's rows.
  if (matches && matches !== selectionsFor) {
    setSelectionsFor(matches);
    const next: Record<number, RowSelection> = {};
    matches.forEach((match, index) => {
      next[index] = {
        checked: match.confidence === "reference",
        invoiceId: match.preselectedInvoiceId ?? match.candidates[0]?.invoiceId ?? null,
      };
    });
    setSelections(next);
  }

  function updateSelection(index: number, patch: Partial<RowSelection>) {
    setSelections((prev) => ({
      ...(prev ?? {}),
      [index]: { ...(prev?.[index] ?? { checked: false, invoiceId: null }), ...patch },
    }));
  }

  function handleConfirm() {
    if (!matches || !selections) return;

    const toConfirm: ImportMatch[] = matches
      .map((match, index) => ({ match, selection: selections[index] }))
      .filter(({ selection }) => selection?.checked && selection.invoiceId !== null)
      .map(({ match, selection }) => ({
        invoiceId: selection.invoiceId as number,
        paidDate: match.transaction.date,
        bankReference: match.transaction.bankReference,
      }));

    if (toConfirm.length === 0) {
      toast.error("Keine Zuordnung ausgewählt.");
      return;
    }

    startConfirm(async () => {
      const result = await markInvoicesPaidFromImport(toConfirm);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const count = result.paidCount ?? 0;
      toast.success(
        count === 1
          ? "1 Rechnung als bezahlt markiert."
          : `${count} Rechnungen als bezahlt markiert.`
      );
      router.push("/invoices");
    });
  }

  const selectedCount = selections
    ? Object.values(selections).filter((s) => s.checked && s.invoiceId !== null).length
    : 0;

  return (
    <div className="space-y-4">
      <form action={parseAction} className="flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".xml"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button type="submit" disabled={isParsing}>
          {isParsing ? "Wird gelesen…" : "Datei analysieren"}
        </Button>
      </form>

      {parseState.error && <p className="text-sm text-destructive">{parseState.error}</p>}

      {parseState.warnings && parseState.warnings.length > 0 && (
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
          {parseState.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {matches && (
        <>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Keine Zahlungseingänge im Kontoauszug gefunden.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Betrag</TableHead>
                    <TableHead>Zuordnung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matches.map((match, index) => {
                    const selection = selections?.[index];
                    const { transaction, candidates, confidence } = match;
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          {candidates.length > 0 && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input accent-primary"
                              checked={selection?.checked ?? false}
                              onChange={(e) =>
                                updateSelection(index, { checked: e.target.checked })
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(transaction.date)}
                        </TableCell>
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
                              value={selection?.invoiceId ? String(selection.invoiceId) : undefined}
                              onValueChange={(value) =>
                                value && updateSelection(index, { invoiceId: Number(value) })
                              }
                            >
                              <SelectTrigger className="w-56">
                                <SelectValue placeholder="Rechnung wählen">
                                  {(value: string | null) =>
                                    value
                                      ? (candidates.find((c) => String(c.invoiceId) === value)
                                          ?.documentNumber ?? value)
                                      : "Rechnung wählen"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {candidates.map((candidate) => (
                                  <SelectItem
                                    key={candidate.invoiceId}
                                    value={String(candidate.invoiceId)}
                                  >
                                    {candidate.documentNumber}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {confidenceLabels.none}
                            </span>
                          )}
                          {candidates.length > 0 && confidence !== "reference" && (
                            <span className="block text-xs text-muted-foreground mt-0.5">
                              {confidenceLabels[confidence]}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {matches.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={handleConfirm} disabled={isConfirming || selectedCount === 0}>
                {isConfirming
                  ? "Wird gespeichert…"
                  : `${selectedCount} Rechnung${selectedCount === 1 ? "" : "en"} als bezahlt markieren`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
