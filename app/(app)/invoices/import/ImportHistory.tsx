"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { ImportOverview } from "@/lib/import/queries";
import { undoStatementImport } from "./actions";

export function ImportHistory({ imports }: { imports: ImportOverview["imports"] }) {
  const [isPending, startTransition] = useTransition();

  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Noch keine Importe.</p>;
  }

  function undo(id: number) {
    if (!window.confirm("Diesen Import mit allen seinen Bewegungen rückgängig machen?")) return;
    startTransition(async () => {
      try {
        const result = await undoStatementImport(id);
        if (result.error) toast.error(result.error);
        else toast.success("Import rückgängig gemacht.");
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Importiert am</TableHead>
            <TableHead>Datei</TableHead>
            <TableHead>Zeitraum</TableHead>
            <TableHead>Bewegungen</TableHead>
            <TableHead>Verbucht</TableHead>
            <TableHead>Warnungen</TableHead>
            <TableHead className="w-28"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
              <TableCell>{entry.filename}</TableCell>
              <TableCell className="whitespace-nowrap">
                {entry.periodFrom && entry.periodTo
                  ? `${formatDate(entry.periodFrom)} – ${formatDate(entry.periodTo)}`
                  : "–"}
              </TableCell>
              <TableCell>{entry.importedCount}</TableCell>
              <TableCell>{entry.bookedCount}</TableCell>
              <TableCell className="min-w-64 max-w-sm whitespace-normal break-words text-xs" title={entry.balanceWarning ?? undefined}>
                {entry.balanceWarning ? (
                  <span className="text-destructive">Warnung: {entry.balanceWarning}</span>
                ) : (
                  <span className="text-muted-foreground">in Ordnung</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending || entry.bookedCount > 0}
                  title={entry.bookedCount > 0 ? "Es sind bereits Bewegungen verbucht." : undefined}
                  onClick={() => undo(entry.id)}
                >
                  Rückgängig
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
