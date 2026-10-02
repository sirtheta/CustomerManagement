import Link from "next/link";
import { UserRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModule } from "@/lib/module-guard";
import { listSubscriptionOverview } from "@/lib/subscription-overview";
import { INTERVAL_LABELS } from "@/lib/subscription-dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SubscriptionRowActions from "./SubscriptionRowActions";

function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

export default async function SubscriptionsPage() {
  await requireModule("subscriptions");
  const [session, rows] = await Promise.all([auth(), listSubscriptionOverview(prisma)]);
  const canEdit = session?.user.role === UserRole.Admin || session?.user.role === UserRole.Editor;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Abos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Intervall, nächste Rechnung und Versand pro Abo. Bearbeiten auf der Kundenseite.
          </p>
        </div>
        <Button variant="outline" render={<Link href="/invoices/pending" />}>
          Ausstehende Abo-Rechnungen
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kunde</TableHead>
              <TableHead>Intervall</TableHead>
              <TableHead>Nächste Rechnung</TableHead>
              <TableHead>Vorlage</TableHead>
              <TableHead>Versand</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-48" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 7 : 6} className="text-center py-12 text-muted-foreground">
                  Noch keine Abos vorhanden. Abos legst du auf der Kundenseite an.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={row.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <Link href={`/customers/${row.customerId}`} className="font-medium hover:underline">
                      {row.customerName}
                    </Link>
                  </TableCell>
                  <TableCell>{INTERVAL_LABELS[row.interval]}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDay(row.nextInvoiceDate)}</TableCell>
                  <TableCell>
                    {row.templateId == null ? (
                      <Badge variant="destructive">Vorlage fehlt</Badge>
                    ) : (
                      row.templateName
                    )}
                  </TableCell>
                  <TableCell>{row.autoSend ? "Automatisch" : "Nach Prüfung"}</TableCell>
                  <TableCell>
                    {row.active ? <Badge variant="outline">Aktiv</Badge> : <Badge variant="secondary">Pausiert</Badge>}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <SubscriptionRowActions
                        customerId={row.customerId}
                        subscriptionId={row.id}
                        active={row.active}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
