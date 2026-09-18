import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireEditor } from "@/lib/permissions";
import { ImportWizard } from "./ImportWizard";

export default async function InvoicesImportPage() {
  await requireEditor();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Zahlungen importieren</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            CAMT.053-Kontoauszug hochladen und passende offene Rechnungen als bezahlt markieren
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          Zurück
        </Button>
      </div>

      <ImportWizard />
    </div>
  );
}
