"use client";

import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { ImportOverview } from "@/lib/import/queries";
import { undoStatementImport } from "./actions";

export function ImportHistory({ imports }: { imports: ImportOverview["imports"] }) {
  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Noch keine Importe.</p>;
  }

  async function undo(id: number): Promise<{ error?: string }> {
    const result = await undoStatementImport(id);
    if (!result.error) toast.success("Import rückgängig gemacht.");
    return result;
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
                  <p className="mt-1 max-w-56 whitespace-normal text-xs text-muted-foreground">
                    {entry.undoBlockedReason}
                  </p>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
