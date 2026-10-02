"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setModule } from "./actions";
import ImmediateCheckbox from "./ImmediateCheckbox";
import { MODULE_INFO, MODULE_KEYS, type ModuleFlags } from "@/lib/modules";

export default function ModulesCard({ modules }: { modules: ModuleFlags }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Module</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nicht benötigte Funktionen ausblenden. Die Daten bleiben erhalten und sind nach dem
          Einschalten wieder da. Änderungen gelten sofort.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {MODULE_KEYS.map((key) => (
          <ImmediateCheckbox
            key={key}
            id={`module_${key}`}
            label={MODULE_INFO[key].label}
            description={MODULE_INFO[key].description}
            checked={modules[key]}
            save={(next) => setModule(key, next)}
            successMessage={`${MODULE_INFO[key].label} ${modules[key] ? "ausgeschaltet" : "eingeschaltet"}`}
          />
        ))}
      </CardContent>
    </Card>
  );
}
