import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { QuoteState } from "@prisma/client";
import { documentLabel } from "@/lib/document-display";
import { customerDisplayName } from "@/lib/customer-display";
import { sumOpenAmount } from "@/lib/payments";
import { INTERVAL_LABELS } from "@/lib/subscription-dates";
import { loadModules } from "@/lib/module-guard";
import { isEditorSession } from "@/lib/permissions";
import { attentionBanners, loadAttentionCounts } from "@/lib/attention-counts";
import { AttentionBanners } from "@/components/attention-banners";

export default async function DashboardPage() {
  const canEdit = isEditorSession(await auth());
  const modules = await loadModules();

  const currentYear = new Date().getFullYear();

  const [
    customerCount,
    openInvoices,
    openQuotes,
    recentInvoices,
    currentYearRevenue,
    attention,
    scheduledSubscriptionCount,
    scheduledSubscriptions,
    openTasks,
  ] = await Promise.all([
    prisma.customer.count({ where: { archivedAt: null } }),
    sumOpenAmount(prisma),
    modules.quotes
      ? prisma.quote.count({
          where: { state: { in: [QuoteState.Draft, QuoteState.Sent] } },
        })
      : 0,
    prisma.invoice.findMany({
      take: 5,
      orderBy: { date: "desc" },
      include: { customer: true },
    }),
    prisma.payment.aggregate({
      where: {
        date: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
      _sum: { amount: true },
    }),
    loadAttentionCounts(prisma, modules, canEdit),
    modules.subscriptions
      ? prisma.subscription.count({
          where: { active: true, customer: { archivedAt: null } },
        })
      : 0,
    modules.subscriptions
      ? prisma.subscription.findMany({
          where: { active: true, customer: { archivedAt: null } },
          select: {
            id: true,
            interval: true,
            nextInvoiceDate: true,
            customer: {
              select: { customerId: true, company: true, contactPerson: true, contactInsteadOfCompany: true },
            },
          },
          orderBy: { nextInvoiceDate: "asc" },
          take: 5,
        })
      : [],
    modules.tasks
      ? prisma.task.findMany({
          where: { doneAt: null, customer: { archivedAt: null } },
          select: {
            id: true,
            title: true,
            dueDate: true,
            customer: { select: { customerId: true, company: true, contactPerson: true, contactInsteadOfCompany: true } },
          },
          orderBy: { dueDate: "asc" },
          take: 5,
        })
      : [],
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <AttentionBanners banners={attentionBanners(attention, modules, canEdit)} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
        <Link href="/customers" className="h-full">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Kunden
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{customerCount}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/invoices" className="h-full">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Offene Rechnungen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{openInvoices.count}</p>
              <p className="text-sm text-gray-500 mt-1">
                {formatCurrency(openInvoices.amount)}
              </p>
            </CardContent>
          </Card>
        </Link>

        {modules.quotes && (
          <Link href="/quotes" className="h-full">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Offene Offerten
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{openQuotes}</p>
              </CardContent>
            </Card>
          </Link>
        )}

        <Link href={modules.analytics ? "/analytics" : "/invoices"} className="h-full">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Einnahmen {currentYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl 2xl:text-3xl font-bold break-words">
                {formatCurrency(currentYearRevenue._sum.amount?.toNumber() ?? 0)}
              </p>
              <p className="text-sm text-gray-500 mt-1">Zahlungseingänge</p>
            </CardContent>
          </Card>
        </Link>

        {modules.subscriptions && (
          <Link href="/subscriptions" className="h-full">
            <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Geplante Abos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{scheduledSubscriptionCount}</p>
                <p className="text-sm text-gray-500 mt-1">Aktive Abos</p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {modules.tasks && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Offene Aufgaben</CardTitle>
          </CardHeader>
          <CardContent>
            {openTasks.length === 0 ? (
              <p className="text-sm text-gray-500">Keine offenen Aufgaben.</p>
            ) : (
              <ul className="divide-y">
                {openTasks.map((task) => (
                  <li key={task.id} className="py-2 flex justify-between items-center gap-3">
                    <Link href={`/customers/${task.customer.customerId}`} className="text-sm hover:underline">
                      <span className="font-medium">{task.title}</span>
                      <span className="text-gray-500">
                        {" · "}
                        {customerDisplayName(task.customer)}
                      </span>
                    </Link>
                    <span
                      className={`text-sm whitespace-nowrap ${task.dueDate < new Date() ? "text-red-600 font-medium" : "text-gray-500"}`}
                    >
                      {formatDate(task.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {modules.subscriptions && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Kommende Abo-Rechnungen</CardTitle>
            <Button variant="outline" size="sm" render={<Link href="/subscriptions" />}>
              Alle anzeigen
            </Button>
          </CardHeader>
          <CardContent>
            {scheduledSubscriptions.length === 0 ? (
              <p className="text-sm text-gray-500">Keine Abos geplant.</p>
            ) : (
              <ul className="divide-y">
                {scheduledSubscriptions.map((sub) => (
                  <li key={sub.id} className="py-2 flex justify-between items-center gap-3">
                    <Link href={`/customers/${sub.customer.customerId}`} className="font-medium text-sm hover:underline">
                      {customerDisplayName(sub.customer)}
                    </Link>
                    <span className="text-sm text-gray-500 whitespace-nowrap">
                      {INTERVAL_LABELS[sub.interval]} · {formatDate(sub.nextInvoiceDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neueste Rechnungen</CardTitle>
        </CardHeader>
        <CardContent>
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-gray-500">Keine Rechnungen vorhanden.</p>
          ) : (
            <ul className="divide-y">
              {recentInvoices.map((inv) => (
                <li key={inv.id} className="py-2 flex justify-between items-center">
                  <div>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium text-sm hover:underline"
                    >
                      {documentLabel(inv.documentNumber)}
                    </Link>
                    {inv.creditNoteForId !== null && (
                      <span className="ml-2 text-xs text-gray-500">Gutschrift</span>
                    )}
                    <p className="text-xs text-gray-500">
                      {customerDisplayName(inv.customer)}
                    </p>
                  </div>
                  <span className="text-sm font-medium">
                    {formatCurrency(inv.totalAmount.toNumber())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
