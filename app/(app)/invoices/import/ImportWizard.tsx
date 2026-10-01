"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { uploadStatement, type UploadStatementState } from "./actions";

export function ImportWizard() {
  const [state, action, isPending] = useActionState<UploadStatementState, FormData>(
    uploadStatement,
    {}
  );

  return (
    <div className="space-y-3">
      <form action={action} className="flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".xml"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Wird gelesen…" : "Datei importieren"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {state.importedCount !== undefined && (
        <p className="text-sm">
          {state.importedCount === 0
            ? "Keine neuen Bewegungen: alle Einträge der Datei waren schon importiert."
            : `${state.importedCount} neue Bewegung${state.importedCount === 1 ? "" : "en"} importiert`}
          {state.skippedCount ? `, ${state.skippedCount} bereits bekannt übersprungen.` : "."}
        </p>
      )}

      {state.warnings && state.warnings.length > 0 && (
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
