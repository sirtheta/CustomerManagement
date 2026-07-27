import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FitText } from "@/components/ui/fit-text";
import { formatCurrency } from "@/lib/utils";
import { fetchAnalyticsData, parseCategoryParam } from "./lib/analytics-queries";
import { YearSelector } from "./components/year-selector";
import { MonthlyRevenueChart } from "./components/monthly-revenue-chart";
import { CategoryBreakdownChart } from "./components/category-breakdown-chart";
import { CategoryCombinedChart } from "./components/category-combined-chart";
import { TopCustomersChart } from "./components/top-customers-chart";
import { DrilldownDrawer } from "./components/drilldown-drawer";

type Props = {
  searchParams: Promise<{
    year?: string;
    drillMonth?: string;
    drillStatus?: string;
    drillCustomer?: string;
    drillIncomeCategory?: string;
    drillExpenseCategory?: string;
    drillCombinedCategory?: string;
  }>;
};

export default async function AnalyticsPage({ searchParams }: Props) {
  await auth();

  const { year, drillMonth, drillStatus, drillCustomer, drillIncomeCategory, drillExpenseCategory, drillCombinedCategory } =
    await searchParams;
  const parsed = parseInt(year ?? "", 10);
  const selectedYear = Number.isNaN(parsed) ? new Date().getFullYear() : parsed;
  const data = await fetchAnalyticsData(selectedYear);

  const drillMonthIndex = drillMonth !== undefined ? parseInt(drillMonth, 10) : undefined;
  const drillCustomerId = drillCustomer !== undefined ? parseInt(drillCustomer, 10) : undefined;
  const drillIncomeCategoryId = parseCategoryParam(drillIncomeCategory);
  const drillExpenseCategoryId = parseCategoryParam(drillExpenseCategory);
  const drillCombinedCategoryId = parseCategoryParam(drillCombinedCategory);
  const drillIncomeCategoryName =
    drillIncomeCategoryId !== undefined
      ? data.incomeByCategory.find((c) => c.categoryId === drillIncomeCategoryId)?.name
      : undefined;
  const drillExpenseCategoryName =
    drillExpenseCategoryId !== undefined
      ? data.expensesByCategory.find((c) => c.categoryId === drillExpenseCategoryId)?.name
      : undefined;
  const drillCombinedCategoryName =
    drillCombinedCategoryId !== undefined
      ? data.combinedByCategory.find((c) => c.categoryId === drillCombinedCategoryId)?.name
      : undefined;
  const hasDrilldown =
    drillMonthIndex !== undefined ||
    drillStatus !== undefined ||
    drillCustomerId !== undefined ||
    drillIncomeCategoryId !== undefined ||
    drillExpenseCategoryId !== undefined ||
    drillCombinedCategoryId !== undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Auswertung</h1>
        <YearSelector availableYears={data.availableYears} selectedYear={data.selectedYear} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jahresumsatz {data.selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={formatCurrency(data.annualRevenue)} className="text-2xl font-bold tabular-nums" />
            <p className="text-xs text-muted-foreground mt-1">Bezahlte Rechnungen</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ausstehend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={formatCurrency(data.outstanding)} className="text-2xl font-bold tabular-nums" />
            <p className="text-xs text-muted-foreground mt-1">
              {data.outstandingCount}{" "}
              {data.outstandingCount === 1 ? "Rechnung" : "Rechnungen"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ø Rechnungsbetrag
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={formatCurrency(data.avgInvoiceAmount)} className="text-2xl font-bold tabular-nums" />
            <p className="text-xs text-muted-foreground mt-1">Ohne Entwürfe & Stornos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bezahlungsquote
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FitText value={`${data.paymentRate.toFixed(1)} %`} className="text-2xl font-bold tabular-nums" />
            <p className="text-xs text-muted-foreground mt-1">Bezahlte von versendeten</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Monatlicher Umsatz {data.selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyRevenueChart data={data.monthlyRevenue} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Einnahmen &amp; Ausgaben nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart income={data.incomeByCategory} expenses={data.expensesByCategory} />
            <div className="mt-6 pt-4 border-t">
              <p className="text-sm font-medium text-muted-foreground mb-2">Kombiniert nach Kategorie</p>
              <CategoryCombinedChart data={data.combinedByCategory} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 Kunden</CardTitle>
          </CardHeader>
          <CardContent>
            <TopCustomersChart data={data.topCustomers} />
          </CardContent>
        </Card>
      </div>

      {hasDrilldown && (
        <Suspense>
          <DrilldownDrawer
            year={selectedYear}
            drillMonth={drillMonthIndex}
            drillStatus={drillStatus}
            drillCustomer={drillCustomerId}
            drillIncomeCategory={drillIncomeCategoryId}
            drillExpenseCategory={drillExpenseCategoryId}
            drillCombinedCategory={drillCombinedCategoryId}
            drillIncomeCategoryName={drillIncomeCategoryName}
            drillExpenseCategoryName={drillExpenseCategoryName}
            drillCombinedCategoryName={drillCombinedCategoryName}
          />
        </Suspense>
      )}
    </div>
  );
}
