"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveModules } from "./actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { MODULE_INFO, MODULE_KEYS, type ModuleFlags } from "@/lib/modules";

export default function ModulesCard({ modules }: { modules: ModuleFlags }) {
  const [state, action, pending] = useActionState(saveModules, {});
  useActionToast(state, "Module gespeichert");
  // After a refused save the form shows what was submitted, not the stored values
  const current = state.values ?? modules;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Module</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nicht benötigte Funktionen ausblenden. Die Daten bleiben erhalten und sind nach dem
          Einschalten wieder da.
        </p>
      </CardHeader>
      <CardContent>
        {/* Eigene <form>, nie in die grosse Einstellungs-Form verschachtelt */}
        <form key={state._ts ?? 0} action={action} className="space-y-3">
          {MODULE_KEYS.map((key) => (
            <div key={key} className="flex items-start gap-3">
              <input
                type="checkbox"
                id={`module_${key}`}
                name={`module_${key}`}
                defaultChecked={current[key]}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <div>
                <Label htmlFor={`module_${key}`} className="cursor-pointer font-medium">
                  {MODULE_INFO[key].label}
                </Label>
                <p className="text-xs text-muted-foreground">{MODULE_INFO[key].description}</p>
              </div>
            </div>
          ))}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Speichert…" : "Module speichern"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
