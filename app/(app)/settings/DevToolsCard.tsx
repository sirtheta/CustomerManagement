"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { triggerNotificationCheck } from "./actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";

export default function DevToolsCard() {
  const [state, action, isPending] = useActionState<ActionState, FormData>(
    () => triggerNotificationCheck(),
    {}
  );
  useActionToast(state, "Benachrichtigungscheck abgeschlossen");

  return (
    <Card className="border-dashed border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-700 dark:text-amber-400">
          Dev-Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Nur in Entwicklungsumgebungen sichtbar.
        </p>
        <div className="flex items-center gap-3">
          <form action={action}>
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              {isPending ? "Wird ausgeführt…" : "Benachrichtigungscheck jetzt auslösen"}
            </Button>
          </form>
          {state?.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
          {state?.success && (
            <p className="text-xs text-green-600 dark:text-green-400">Abgeschlossen</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Führt checkAndUpdateAllDocumentStates, checkOverdueInvoices, checkYearlyInvoices und sendAdminNotifications aus — identisch zum Cron-Job.
        </p>
      </CardContent>
    </Card>
  );
}
