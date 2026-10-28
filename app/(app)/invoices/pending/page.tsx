import prisma from "@/lib/prisma";
import PendingEmailRow from "./PendingEmailRow";
import { requireModule } from "@/lib/module-guard";
import { auth } from "@/lib/auth";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { customerDisplayName } from "@/lib/customer-display";
import { BackLink } from "@/components/back-link";

export default async function PendingEmailsPage() {
  await requireModule("subscriptions");
  if (!isEditorSession(await auth())) return <EditorOnlyNotice backHref="/invoices" backLabel="Zu den Rechnungen" />;
  const pending = await prisma.pendingEmail.findMany({
    include: {
      invoice: { include: { customer: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href="/invoices">Rechnungen</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Abo-Rechnungen freigeben</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Abo-Rechnungen prüfen und versenden
        </p>
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Keine Abo-Rechnungen zur Freigabe.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.map((p) => {
            const c = p.invoice.customer;
            const customerName = customerDisplayName(c);
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
