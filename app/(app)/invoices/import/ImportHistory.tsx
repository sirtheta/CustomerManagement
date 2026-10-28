"use client";

import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { ImportOverview } from "@/lib/import/queries";
import { undoStatementImport } from "./actions";

type Entry = ImportOverview["imports"][number];

function UndoButton({ entry, undo }: { entry: Entry; undo: (id: number) => Promise<{ error?: string }> }) {
  return (
    <>
      <ConfirmDialog
        title="Import rückgängig machen"
        description={`Der Import «${entry.filename}» wird mit allen ${entry.importedCount} Bewegungen gelöscht, auch den ignorierten. Die Datei kann danach erneut hochgeladen werden.`}
        confirmLabel="Rückgängig machen"
        triggerVariant="ghost"
        triggerSize="sm"
        triggerDisabled={entry.undoBlockedReason !== null}
        onConfirm={() => undo(entry.id)}
      >
        Rückgängig
      </ConfirmDialog>
      {entry.undoBlockedReason && (
        // Short hint as text; the full reason opens on demand (also for screen readers).
        <details className="mt-1 max-w-56 text-xs text-muted-foreground">
          <summary className="cursor-pointer truncate" title={entry.undoBlockedReason}>
            {entry.undoBlockedHint ?? entry.undoBlockedReason}
          </summary>
          <p className="mt-1 whitespace-normal">{entry.undoBlockedReason}</p>
        </details>
      )}
    </>
  );
}

export function ImportHistory({ imports }: { imports: ImportOverview["imports"] }) {
  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Noch keine Importe vorhanden.</p>;
  }

  async function undo(id: number): Promise<{ error?: string }> {
    const result = await undoStatementImport(id);
    if (!result.error) toast.success("Import rückgängig gemacht");
    return result;
  }

  return (
    <>
      {/* Phones get cards instead of a seven-column table */}
      <ul className="space-y-3 md:hidden">
        {imports.map((entry) => (
          <li key={entry.id} className="rounded-lg border p-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-all font-medium">{entry.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {entry.periodFrom && entry.periodTo
                ? `${formatDate(entry.periodFrom)} – ${formatDate(entry.periodTo)}`
                : "–"}
              {` · ${entry.importedCount} Bewegungen, ${entry.bookedCount} verbucht`}
            </p>
            <p className="text-xs">
              {entry.balanceWarning ? (
                <span className="text-destructive">Warnung: {entry.balanceWarning}</span>
              ) : (
                <span className="text-muted-foreground">in Ordnung</span>
              )}
            </p>
            <UndoButton entry={entry} undo={undo} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Importiert am</TableHead>
              <TableHead>Datei</TableHead>
              <TableHead>Zeitraum</TableHead>
              <TableHead>Bewegungen</TableHead>
              <TableHead>Verbucht</TableHead>
              <TableHead>Warnungen</TableHead>
              <TableHead className="w-56"></TableHead>
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
                  <UndoButton entry={entry} undo={undo} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
