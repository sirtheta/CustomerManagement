import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { InvoiceState, QuoteState } from "@prisma/client";
import { AlertTriangle } from "lucide-react";

export default async function DashboardPage() {
  await auth();

  const currentYear = new Date().getFullYear();

  const [
    customerCount,
    openInvoices,
    openQuotes,
    recentInvoices,
    currentYearRevenue,
    pendingEmailCount,
    overdueCount,
    scheduledCustomers,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.invoice.aggregate({
      where: { state: { in: [InvoiceState.Sent, InvoiceState.Overdue] } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.quote.count({
      where: { state: { in: [QuoteState.Draft, QuoteState.Sent] } },
    }),
    prisma.invoice.findMany({
      take: 5,
      orderBy: { date: "desc" },
      include: { customer: true },
    }),
    prisma.invoice.aggregate({
      where: {
        state: InvoiceState.Paid,
        paidDate: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
      _sum: { totalAmount: true },
    }),
    prisma.pendingEmail.count(),
    prisma.invoice.count({ where: { state: InvoiceState.Overdue } }),
    prisma.customer.findMany({
      where: { yearlyInvoice: true, nextInvoiceDate: { not: null } },
      select: {
        customerId: true,
        company: true,
        contactPerson: true,
        contactInsteadOfCompany: true,
        nextInvoiceDate: true,
      },
      orderBy: { nextInvoiceDate: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Warnings */}
      {(pendingEmailCount > 0 || overdueCount > 0) && (
        <div className="space-y-2">
          {pendingEmailCount > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                  {pendingEmailCount === 1
                    ? "1 Jahresrechnung wartet auf Prüfung und Versand."
                    : `${pendingEmailCount} Jahresrechnungen warten auf Prüfung und Versand.`}
                </p>
              </div>
              <Button size="sm" render={<Link href="/invoices/pending" />}>
                Jetzt prüfen
              </Button>
            </div>
          )}
          {overdueCount > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="size-4 text-red-600 dark:text-red-400 shrink-0" />
                <p className="text-sm font-medium text-red-900 dark:text-red-200">
                  {overdueCount === 1
                    ? "1 Rechnung ist überfällig."
                    : `${overdueCount} Rechnungen sind überfällig.`}
                </p>
              </div>
              <Button size="sm" variant="outline" render={<Link href="/invoices?state=Overdue" />}>
                Anzeigen
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
              <p className="text-3xl font-bold">{openInvoices._count}</p>
              <p className="text-sm text-gray-500 mt-1">
                {formatCurrency(openInvoices._sum.totalAmount?.toNumber() ?? 0)}
              </p>
            </CardContent>
          </Card>
        </Link>

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

        <Link href="/analytics" className="h-full">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Einnahmen {currentYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {formatCurrency(currentYearRevenue._sum.totalAmount?.toNumber() ?? 0)}
              </p>
              <p className="text-sm text-gray-500 mt-1">Bezahlte Rechnungen</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/customers?yearlyInvoice=true" className="h-full">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Geplante Jahresrechnungen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{scheduledCustomers.length}</p>
              <p className="text-sm text-gray-500 mt-1">Aktive Planungen</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Kommende Jahresrechnungen</CardTitle>
          <Button variant="outline" size="sm" render={<Link href="/customers?yearlyInvoice=true" />}>
            Alle anzeigen
          </Button>
        </CardHeader>
        <CardContent>
          {scheduledCustomers.length === 0 ? (
            <p className="text-sm text-gray-500">Keine Jahresrechnungen geplant.</p>
          ) : (
            <ul className="divide-y">
              {scheduledCustomers.slice(0, 5).map((customer) => (
                <li key={customer.customerId} className="py-2 flex justify-between items-center gap-3">
                  <Link href={`/customers/${customer.customerId}`} className="font-medium text-sm hover:underline">
                    {customer.contactInsteadOfCompany
                      ? customer.contactPerson
                      : (customer.company || customer.contactPerson)}
                  </Link>
                  <span className="text-sm text-gray-500 whitespace-nowrap">
                    {customer.nextInvoiceDate?.toLocaleDateString("de-CH")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
                      {inv.documentNumber}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {inv.customer.contactInsteadOfCompany
                        ? inv.customer.contactPerson
                        : (inv.customer.company || inv.customer.contactPerson)}
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
