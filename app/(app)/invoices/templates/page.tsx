import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireEditor } from "@/lib/permissions";
import DeleteTemplateButton from "./DeleteTemplateButton";
import ItemsView from "@/components/items-view";

export default async function TemplatesPage() {
  await requireEditor();

  const templates = await prisma.invoiceTemplate.findMany({
    include: { items: { orderBy: { id: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rechnungsvorlagen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gespeicherte Positionsvorlagen für schnelle Rechnungserstellung
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          ← Rechnungen
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
          Noch keine Vorlagen vorhanden. Speichere eine bestehende Rechnung als Vorlage.
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
                <span className="font-medium">{tpl.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {tpl.items.length} Position{tpl.items.length !== 1 ? "en" : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link href={`/invoices/templates/${tpl.id}`} />}
                  >
                    Bearbeiten
                  </Button>
                  <DeleteTemplateButton templateId={tpl.id} />
                </div>
              </div>
              {tpl.items.length > 0 && (
                <div className="p-3 sm:p-0">
                  <ItemsView
                    items={tpl.items.map((item) => ({
                      id: item.id,
                      name: item.name,
                      description: item.description,
                      unit: item.unit,
                      quantity: item.quantity.toNumber(),
                      unitPrice: item.unitPrice.toNumber(),
                      totalAmount:
                        item.quantity.toNumber() * item.unitPrice.toNumber(),
                    }))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
