import Link from "next/link";
import prisma from "@/lib/prisma";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { hasRole, isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { FlashToast } from "@/components/flash-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FitText } from "@/components/ui/fit-text";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  fetchIncomeStatement,
  fetchPaymentsForYear,
  fetchExpensesForYear,
} from "./lib/income-statement-queries";
import { YearSelector } from "./components/year-selector";
import { ProfitLossChart } from "./components/profit-loss-chart";
import DeleteExpenseButton from "./DeleteExpenseButton";
import { documentLabel } from "@/lib/document-display";
import { Badge } from "@/components/ui/badge";
import { requireModule } from "@/lib/module-guard";

type Props = {
  searchParams: Promise<{ year?: string }>;
};

type ExpenseRow = { paidDate: string | null; dueDate: string | null };

function ExpenseStatus({ exp, today }: { exp: ExpenseRow; today: string }) {
  if (exp.paidDate) return <Badge variant="secondary">Bezahlt</Badge>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant={exp.dueDate && exp.dueDate.slice(0, 10) < today ? "destructive" : "outline"}>Offen</Badge>
      {exp.dueDate && <span className="text-xs text-muted-foreground">fällig {formatDate(exp.dueDate)}</span>}
    </div>
  );
}

export default async function AccountingPage({ searchParams }: Props) {
  await requireModule("accounting");
  const session = await auth();
  if (!isEditorSession(session)) return <EditorOnlyNotice />;
  // deleteExpense requires an Admin
  const canDelete = session ? hasRole(session, [UserRole.Admin]) : false;

  const { year } = await searchParams;
  const parsedYear = year ? parseInt(year, 10) : NaN;
  const selectedYear = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();

  const [statement, payments, expenses] = await Promise.all([
    fetchIncomeStatement(prisma, selectedYear),
    fetchPaymentsForYear(prisma, selectedYear),
    fetchExpensesForYear(prisma, selectedYear),
  ]);

  const openExpenses = expenses.filter((e) => e.paidDate === null);
  const openTotal = openExpenses.reduce((sum, e) => sum + e.amount, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Buchhaltung</h1>
        <div className="flex flex-wrap items-center gap-3">
          <YearSelector availableYears={statement.availableYears} selectedYear={statement.selectedYear} />
          <Button render={<Link href="/accounting/new" />}>Neue Ausgabe</Button>
          <Button variant="outline" render={<Link href="/accounting/receivables" />}>
            Offene Posten
          </Button>
          <Button
            variant="outline"
            render={<Link href={`/api/export/accounting?year=${selectedYear}`} />}
          >
            CSV-Export
          </Button>
          <Button
            variant="outline"
            render={<a href={`/api/export/year-package?year=${selectedYear}`} download />}
          >
            Jahrespaket (ZIP)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Einnahmen {statement.selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={formatCurrency(statement.totalIncome)} className="text-2xl font-bold tabular-nums" />
            <p className="text-xs text-muted-foreground mt-1">Bezahlte Rechnungen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ausgaben {statement.selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={formatCurrency(statement.totalExpenses)} className="text-2xl font-bold tabular-nums" />
          </CardContent>
        </Card>

        <Card className={statement.netResult >= 0 ? "border-green-500/40" : "border-destructive/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ergebnis {statement.selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText
              value={formatCurrency(statement.netResult)}
              className={cn(
                "text-2xl font-bold tabular-nums",
                statement.netResult >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive",
              )}
            />
            <p className="text-xs text-muted-foreground mt-1">Einnahmen − Ausgaben</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gewinn &amp; Verlust {statement.selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfitLossChart data={statement.monthlyResults} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monatsübersicht {statement.selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead>Einnahmen</TableHead>
                  <TableHead>Ausgaben</TableHead>
                  <TableHead>Ergebnis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.monthlyResults.map((m) => (
                  <TableRow key={m.monthIndex}>
                    <TableCell>{m.month}</TableCell>
                    <TableCell>{formatCurrency(m.income)}</TableCell>
                    <TableCell>{formatCurrency(m.expenses)}</TableCell>
                    <TableCell
                      className={cn(
                        "font-medium",
                        m.net > 0 && "text-green-600 dark:text-green-400",
                        m.net < 0 && "text-destructive",
                      )}
                    >
                      {formatCurrency(m.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ausgaben {statement.selectedYear}</CardTitle>
            {openExpenses.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {openExpenses.length} offene Lieferantenrechnung{openExpenses.length === 1 ? "" : "en"}:{" "}
                {formatCurrency(openTotal)}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {expenses.length > 0 && (
              // Phones get cards instead of a table with eight columns
              <ul className="space-y-3 md:hidden">
                {expenses.map((exp) => (
                  <li key={exp.id} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{exp.description}</span>
                      <span className="font-semibold">{formatCurrency(exp.amount)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(exp.date)}
                      {exp.supplier && ` · ${exp.supplier}`}
                      {exp.categoryName && ` · ${exp.categoryName}`}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ExpenseStatus exp={exp} today={today} />
                        {exp.receiptCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {exp.receiptCount} Beleg{exp.receiptCount === 1 ? "" : "e"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" render={<Link href={`/accounting/${exp.id}`} />}>
                          Bearbeiten
                        </Button>
                        {canDelete && <DeleteExpenseButton expenseId={exp.id} size="sm" />}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className={expenses.length > 0 ? "hidden overflow-x-auto md:block" : "overflow-x-auto"}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Lieferant</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead>Betrag</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Belege</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        Noch keine Ausgaben vorhanden.
                      </TableCell>
                    </TableRow>
                  ) : (
                    expenses.map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell>{formatDate(exp.date)}</TableCell>
                        <TableCell>{exp.description}</TableCell>
                        <TableCell>{exp.supplier ?? "—"}</TableCell>
                        <TableCell>{exp.categoryName ?? "—"}</TableCell>
                        <TableCell>{formatCurrency(exp.amount)}</TableCell>
                        <TableCell>
                          <ExpenseStatus exp={exp} today={today} />
                        </TableCell>
                        <TableCell>{exp.receiptCount > 0 ? exp.receiptCount : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              render={<Link href={`/accounting/${exp.id}`} />}
                            >
                              Bearbeiten
                            </Button>
                            {canDelete && <DeleteExpenseButton expenseId={exp.id} size="sm" />}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Zahlungseingänge {statement.selectedYear}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bezahlt am</TableHead>
                    <TableHead>Rechnung</TableHead>
                    <TableHead>Kunde</TableHead>
                    <TableHead>Betrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Noch keine Zahlungseingänge vorhanden.
                      </TableCell>
                    </TableRow>
                  ) : (
                    payments.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{formatDate(inv.paidDate)}</TableCell>
                        <TableCell>
                          <Link href={`/invoices/${inv.invoiceId}`} className="underline">
                            {documentLabel(inv.documentNumber)}
                          </Link>
                        </TableCell>
                        <TableCell>{inv.customerName}</TableCell>
                        <TableCell>{formatCurrency(inv.amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
