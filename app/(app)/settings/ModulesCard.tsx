"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { pauseAllSubscriptions, setModule } from "./actions";
import ImmediateCheckbox from "./ImmediateCheckbox";
import { MODULE_INFO, MODULE_KEYS, type ModuleFlags } from "@/lib/modules";

type Props = {
  modules: ModuleFlags;
  activeSubscriptions: number;
  pendingEmails: number;
};

// What still blocks switching Abos off, with the way out (see MODULE_BLOCKERS).
function SubscriptionBlockers({ activeSubscriptions, pendingEmails }: Omit<Props, "modules">) {
  if (activeSubscriptions === 0 && pendingEmails === 0) return null;
  return (
    <div className="ml-7 space-y-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <p>Zum Ausschalten dürfen keine Abos aktiv sein und keine Abo-Rechnungen auf Freigabe warten.</p>
      {activeSubscriptions > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span>{activeSubscriptions === 1 ? "1 aktives Abo." : `${activeSubscriptions} aktive Abos.`}</span>
          <ConfirmDialog
            title="Alle Abos pausieren"
            description={`Es ${activeSubscriptions === 1 ? "wird 1 aktives Abo" : `werden ${activeSubscriptions} aktive Abos`} pausiert. Es entstehen keine neuen Rechnungen mehr. Pausierte Abos behalten ihr Datum und lassen sich später wieder fortsetzen.`}
            confirmLabel="Alle pausieren"
            confirmVariant="default"
            triggerVariant="outline"
            triggerSize="sm"
            onConfirm={async () => {
              const result = await pauseAllSubscriptions();
              if (result.error) return result;
              toast.success(result.paused === 1 ? "1 Abo pausiert" : `${result.paused ?? 0} Abos pausiert`);
            }}
          >
            Alle Abos pausieren
          </ConfirmDialog>
        </div>
      )}
      {pendingEmails > 0 && (
        <p>
          {pendingEmails} Abo-Rechnung(en) warten auf Freigabe:{" "}
          <Link href="/invoices/pending" className="text-primary hover:underline">
            unter «Ausstehende E-Mails» freigeben oder verwerfen
          </Link>
          .
        </p>
      )}
    </div>
  );
}

export default function ModulesCard({ modules, activeSubscriptions, pendingEmails }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Module</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nicht benötigte Funktionen ausblenden. Die Daten bleiben erhalten und sind nach dem
          Einschalten wieder da.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {MODULE_KEYS.map((key) => (
          <div key={key} className="space-y-2">
            <ImmediateCheckbox
              id={`module_${key}`}
              label={MODULE_INFO[key].label}
              description={MODULE_INFO[key].description}
              checked={modules[key]}
              save={(next) => setModule(key, next)}
              successMessage={`${MODULE_INFO[key].label} ${modules[key] ? "ausgeschaltet" : "eingeschaltet"}`}
            />
            {key === "subscriptions" && modules.subscriptions && (
              <SubscriptionBlockers activeSubscriptions={activeSubscriptions} pendingEmails={pendingEmails} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
