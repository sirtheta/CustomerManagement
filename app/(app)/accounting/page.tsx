import Link from "next/link";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
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
  fetchPaidInvoicesForYear,
  fetchExpensesForYear,
} from "./lib/income-statement-queries";
import { YearSelector } from "./components/year-selector";
import { ProfitLossChart } from "./components/profit-loss-chart";
import DeleteExpenseButton from "./DeleteExpenseButton";

type Props = {
  searchParams: Promise<{ year?: string }>;
};

export default async function AccountingPage({ searchParams }: Props) {
  await requireEditor();

  const { year } = await searchParams;
  const parsedYear = year ? parseInt(year, 10) : NaN;
  const selectedYear = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();

  const [statement, paidInvoices, expenses] = await Promise.all([
    fetchIncomeStatement(prisma, selectedYear),
    fetchPaidInvoicesForYear(prisma, selectedYear),
    fetchExpensesForYear(prisma, selectedYear),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Buchhaltung</h1>
        <div className="flex items-center gap-3">
          <YearSelector availableYears={statement.availableYears} selectedYear={statement.selectedYear} />
          <Button render={<Link href="/accounting/new" />}>Neue Ausgabe</Button>
          <Button
            variant="outline"
            render={<Link href={`/api/export/accounting?year=${selectedYear}`} />}
          >
            CSV-Export
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ausgaben {statement.selectedYear}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Bezeichnung</TableHead>
                    <TableHead>Kategorie</TableHead>
                    <TableHead>Betrag</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                        Keine Ausgaben vorhanden.
                      </TableCell>
                    </TableRow>
                  ) : (
                    expenses.map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell>{formatDate(exp.date)}</TableCell>
                        <TableCell>{exp.description}</TableCell>
                        <TableCell>{exp.categoryName ?? "—"}</TableCell>
                        <TableCell>{formatCurrency(exp.amount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              render={<Link href={`/accounting/${exp.id}`} />}
                            >
                              Bearbeiten
                            </Button>
                            <DeleteExpenseButton expenseId={exp.id} size="sm" />
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
            <CardTitle className="text-base">Bezahlte Rechnungen {statement.selectedYear}</CardTitle>
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
                  {paidInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                        Keine bezahlten Rechnungen vorhanden.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paidInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{formatDate(inv.paidDate)}</TableCell>
                        <TableCell>
                          <Link href={`/invoices/${inv.id}`} className="underline">
                            {inv.documentNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{inv.customerName}</TableCell>
                        <TableCell>{formatCurrency(inv.totalAmount)}</TableCell>
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
