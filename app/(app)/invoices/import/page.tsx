import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireEditor } from "@/lib/permissions";
import { loadImportOverview } from "@/lib/import/queries";
import { ImportWizard } from "./ImportWizard";
import { IncomingTable } from "./IncomingTable";
import { ExpensesTable } from "./ExpensesTable";
import { ImportHistory } from "./ImportHistory";
import { loadModules, requireModule } from "@/lib/module-guard";

export default async function InvoicesImportPage() {
  await requireEditor();
  await requireModule("bankImport");
  const overview = await loadImportOverview();
  const modules = await loadModules();

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bankimport</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            CAMT.053-Kontoauszug hochladen, Zahlungseingänge Rechnungen zuordnen und Geschäftsausgaben übernehmen
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          Zurück
        </Button>
      </div>

      <ImportWizard />

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Zahlungseingänge</h2>
        <IncomingTable rows={overview.incoming} />
      </section>

      {modules.accounting && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Ausgaben</h2>
          <p className="text-sm text-muted-foreground">
            Es werden nur angekreuzte Zeilen als Ausgabe übernommen. Privates lässt du offen oder ignorierst es.
          </p>
          <ExpensesTable
            rows={overview.expenses}
            categories={overview.categories}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Importverlauf</h2>
        <ImportHistory imports={overview.imports} />
      </section>
    </div>
  );
}
