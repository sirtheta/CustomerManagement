import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import {
  fetchDrilldownInvoices,
  fetchDrilldownIncomeItems,
  fetchDrilldownExpenses,
  fetchCustomerName,
  type DrilldownIncomeItem,
  type DrilldownExpense,
} from "../lib/analytics-queries";
import { CloseDrawerButton } from "./close-drawer-button";
import { InvoiceState } from "@prisma/client";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const STATE_LABELS: Partial<Record<InvoiceState, string>> = {
  Sent: "Versendet",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
  Draft: "Entwurf",
};

const STATE_BADGE: Partial<Record<InvoiceState, string>> = {
  Paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Overdue: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Canceled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  Draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

type Props = {
  year: number;
  drillMonth?: number;
  drillStatus?: string;
  drillCustomer?: number;
  drillIncomeCategory?: number | null;
  drillExpenseCategory?: number | null;
  drillCombinedCategory?: number | null;
  drillIncomeCategoryName?: string;
  drillExpenseCategoryName?: string;
  drillCombinedCategoryName?: string;
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function DrilldownLayout({
  label,
  title,
  children,
  footer,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <>
      {/* Backdrop */}
      <CloseDrawerButton asBackdrop />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 h-full w-full md:w-[720px] bg-background border-l shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <h2 className="text-lg font-semibold truncate">{title}</h2>
          </div>
          <CloseDrawerButton />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">{children}</div>

        {/* Footer with total */}
        {footer}
      </div>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

async function InvoiceDrilldown({
  year,
  drillMonth,
  drillStatus,
  drillCustomer,
}: {
  year: number;
  drillMonth?: number;
  drillStatus?: string;
  drillCustomer?: number;
}) {
  const [invoices, resolvedCustomerName] = await Promise.all([
    fetchDrilldownInvoices(year, drillMonth, drillStatus, drillCustomer),
    drillCustomer !== undefined ? fetchCustomerName(drillCustomer) : Promise.resolve(undefined),
  ]);
  const showCustomerCol = drillCustomer === undefined;

  const label = drillMonth !== undefined ? "Monat" : drillStatus ? "Status" : "Kunde";
  const title =
    drillMonth !== undefined
      ? `${MONTH_NAMES[drillMonth]} ${year}`
      : drillStatus
        ? STATE_LABELS[drillStatus as InvoiceState] ?? drillStatus
        : (resolvedCustomerName ?? `Kunde #${drillCustomer}`);

  const total = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

  return (
    <DrilldownLayout
      label={label}
      title={title}
      footer={
        invoices.length > 0 && (
          <div className="px-5 py-3 border-t bg-muted/30 shrink-0 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {invoices.length} {invoices.length === 1 ? "Rechnung" : "Rechnungen"}
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
          </div>
        )
      }
    >
      {invoices.length === 0 ? (
        <EmptyState text="Keine Rechnungen vorhanden" />
      ) : (
        <table className="w-full text-sm table-fixed">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="w-[26%] sm:w-[26%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Nr.</th>
              <th className="w-[30%] sm:w-[40%] text-left px-2 sm:px-3 py-2 font-medium text-muted-foreground">
                {showCustomerCol ? "Kunde" : "Datum"}
              </th>
              <th className="w-[24%] sm:w-[20%] text-left px-3 py-2 font-medium text-muted-foreground">Betrag</th>
              <th className="hidden sm:table-cell sm:w-[14%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 sm:px-5 py-3">
                  <Link href={`/invoices/${inv.id}`} className="font-mono text-xs text-primary hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                  <span
                    className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium sm:hidden ${STATE_BADGE[inv.state] ?? ""}`}
                  >
                    {STATE_LABELS[inv.state] ?? inv.state}
                  </span>
                </td>
                <td className="px-2 sm:px-3 py-3">
                  {showCustomerCol ? (
                    <>
                      <Link href={`/customers/${inv.customerId}`} className="truncate block hover:underline text-primary">
                        {inv.customerName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{formatDate(inv.date)}</p>
                    </>
                  ) : (
                    <p className="text-sm">{formatDate(inv.date)}</p>
                  )}
                </td>
                <td className="px-3 py-3 text-left tabular-nums font-medium">{formatCurrency(inv.totalAmount)}</td>
                <td className="px-3 sm:px-5 py-3 text-right hidden sm:table-cell">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATE_BADGE[inv.state] ?? ""}`}>
                    {STATE_LABELS[inv.state] ?? inv.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DrilldownLayout>
  );
}

async function IncomeCategoryDrilldown({
  year,
  categoryId,
  categoryName,
}: {
  year: number;
  categoryId: number | null;
  categoryName: string;
}) {
  const items = await fetchDrilldownIncomeItems(year, categoryId);
  const total = items.reduce((sum, item) => sum + item.totalAmount, 0);

  return (
    <DrilldownLayout label="Kategorie · Einnahmen" title={categoryName}
      footer={
        items.length > 0 && (
          <div className="px-5 py-3 border-t bg-muted/30 shrink-0 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "Position" : "Positionen"}
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
          </div>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState text="Keine Einnahmen vorhanden" />
      ) : (
        <table className="w-full text-sm table-fixed">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="w-[26%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Nr.</th>
              <th className="w-[44%] text-left px-2 sm:px-3 py-2 font-medium text-muted-foreground">Position</th>
              <th className="w-[30%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Betrag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item: DrilldownIncomeItem) => (
              <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 sm:px-5 py-3">
                  <Link href={`/invoices/${item.invoiceId}`} className="font-mono text-xs text-primary hover:underline">
                    {item.invoiceNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">{item.customerName}</p>
                </td>
                <td className="px-2 sm:px-3 py-3">
                  <p className="truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(item.date)}</p>
                </td>
                <td className="px-3 sm:px-5 py-3 text-left tabular-nums font-medium">
                  {formatCurrency(item.totalAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DrilldownLayout>
  );
}

async function ExpenseCategoryDrilldown({
  year,
  categoryId,
  categoryName,
}: {
  year: number;
  categoryId: number | null;
  categoryName: string;
}) {
  const expenses = await fetchDrilldownExpenses(year, categoryId);
  const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  return (
    <DrilldownLayout label="Kategorie · Ausgaben" title={categoryName}
      footer={
        expenses.length > 0 && (
          <div className="px-5 py-3 border-t bg-muted/30 shrink-0 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {expenses.length} {expenses.length === 1 ? "Ausgabe" : "Ausgaben"}
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
          </div>
        )
      }
    >
      {expenses.length === 0 ? (
        <EmptyState text="Keine Ausgaben vorhanden" />
      ) : (
        <table className="w-full text-sm table-fixed">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="w-[30%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Beschreibung</th>
              <th className="w-[20%] text-left px-2 sm:px-3 py-2 font-medium text-muted-foreground">Datum</th>
              <th className="w-[30%] text-left px-3 sm:px-5 py-2 font-medium text-muted-foreground">Betrag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {expenses.map((exp: DrilldownExpense) => (
              <tr key={exp.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 sm:px-5 py-3">
                  <Link href={`/accounting/${exp.id}`} className="truncate block hover:underline text-primary">
                    {exp.description}
                  </Link>
                </td>
                <td className="px-2 sm:px-3 py-3 text-sm">{formatDate(exp.date)}</td>
                <td className="px-3 sm:px-5 py-3 text-left tabular-nums font-medium">{formatCurrency(exp.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DrilldownLayout>
  );
}

async function CombinedCategoryDrilldown({
  year,
  categoryId,
  categoryName,
}: {
  year: number;
  categoryId: number | null;
  categoryName: string;
}) {
  const [items, expenses] = await Promise.all([
    fetchDrilldownIncomeItems(year, categoryId),
    fetchDrilldownExpenses(year, categoryId),
  ]);
  const incomeTotal = items.reduce((sum, i) => sum + i.totalAmount, 0);
  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <DrilldownLayout
      label="Kategorie · Einnahmen &amp; Ausgaben"
      title={categoryName}
      footer={
        (items.length > 0 || expenses.length > 0) && (
          <div className="px-5 py-3 border-t bg-muted/30 shrink-0 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Einnahmen</span>
              <span className="tabular-nums">{formatCurrency(incomeTotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Ausgaben</span>
              <span className="tabular-nums">{formatCurrency(expenseTotal)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold pt-1 border-t">
              <span>Netto</span>
              <span className="tabular-nums">{formatCurrency(incomeTotal - expenseTotal)}</span>
            </div>
          </div>
        )
      }
    >
      {items.length === 0 && expenses.length === 0 ? (
        <EmptyState text="Keine Daten vorhanden" />
      ) : (
        <div className="divide-y divide-border">
          {items.length > 0 && (
            <div>
              <p className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/50">
                Einnahmen ({items.length})
              </p>
              <table className="w-full text-sm table-fixed">
                <tbody className="divide-y divide-border">
                  {items.map((item: DrilldownIncomeItem) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="w-[30%] px-3 sm:px-5 py-3">
                        <Link href={`/invoices/${item.invoiceId}`} className="font-mono text-xs text-primary hover:underline">
                          {item.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground truncate">{item.customerName}</p>
                      </td>
                      <td className="w-[40%] px-2 sm:px-3 py-3">
                        <p className="truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(item.date)}</p>
                      </td>
                      <td className="w-[30%] px-3 sm:px-5 py-3 text-left tabular-nums font-medium">
                        {formatCurrency(item.totalAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expenses.length > 0 && (
            <div>
              <p className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/50">
                Ausgaben ({expenses.length})
              </p>
              <table className="w-full text-sm table-fixed">
                <tbody className="divide-y divide-border">
                  {expenses.map((exp: DrilldownExpense) => (
                    <tr key={exp.id} className="hover:bg-muted/30 transition-colors">
                      <td className="w-[50%] px-3 sm:px-5 py-3">
                        <Link href={`/accounting/${exp.id}`} className="truncate block hover:underline text-primary">
                          {exp.description}
                        </Link>
                      </td>
                      <td className="w-[24%] px-2 sm:px-3 py-3 text-sm">{formatDate(exp.date)}</td>
                      <td className="w-[26%] px-3 sm:px-5 py-3 text-left tabular-nums font-medium">
                        {formatCurrency(exp.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DrilldownLayout>
  );
}

export async function DrilldownDrawer({
  year,
  drillMonth,
  drillStatus,
  drillCustomer,
  drillIncomeCategory,
  drillExpenseCategory,
  drillCombinedCategory,
  drillIncomeCategoryName,
  drillExpenseCategoryName,
  drillCombinedCategoryName,
}: Props) {
  if (drillCombinedCategory !== undefined) {
    return (
      <CombinedCategoryDrilldown
        year={year}
        categoryId={drillCombinedCategory}
        categoryName={drillCombinedCategoryName ?? "Kategorie"}
      />
    );
  }
  if (drillIncomeCategory !== undefined) {
    return (
      <IncomeCategoryDrilldown
        year={year}
        categoryId={drillIncomeCategory}
        categoryName={drillIncomeCategoryName ?? "Kategorie"}
      />
    );
  }
  if (drillExpenseCategory !== undefined) {
    return (
      <ExpenseCategoryDrilldown
        year={year}
        categoryId={drillExpenseCategory}
        categoryName={drillExpenseCategoryName ?? "Kategorie"}
      />
    );
  }
  return (
    <InvoiceDrilldown year={year} drillMonth={drillMonth} drillStatus={drillStatus} drillCustomer={drillCustomer} />
  );
}
