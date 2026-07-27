import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import PendingEmailRow from "./PendingEmailRow";

export default async function PendingEmailsPage() {
  const pending = await prisma.pendingEmail.findMany({
    include: {
      invoice: { include: { customer: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ausstehende E-Mails</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Jahresrechnungen prüfen und versenden
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          Zurück
        </Button>
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Keine ausstehenden E-Mails.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => {
            const c = p.invoice.customer;
            const customerName = c.contactInsteadOfCompany
              ? c.contactPerson
              : (c.company || c.contactPerson);
            return (
              <PendingEmailRow
                key={p.id}
                id={p.id}
                invoiceId={p.invoiceId}
                documentNumber={p.invoice.documentNumber}
                customerName={customerName}
                totalAmount={p.invoice.totalAmount.toNumber()}
                to={p.to}
                subject={p.subject}
                body={p.body}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
