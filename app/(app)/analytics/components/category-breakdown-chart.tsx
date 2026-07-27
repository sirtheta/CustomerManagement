"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { categoryParamValue } from "../lib/analytics-utils";
import type { CategoryAmount } from "../lib/analytics-queries";

function CustomTooltip({ active, payload }: { active?: boolean; payload?: unknown }) {
  if (!active) return null;
  const items = Array.isArray(payload) ? (payload as Array<{ payload: CategoryAmount }>) : [];
  if (!items.length) return null;
  const d = items[0].payload;
  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{d.name}</p>
      <p>{formatCurrency(d.total)}</p>
      <p className="text-muted-foreground mt-1">Klicken für Details</p>
    </div>
  );
}

function CategoryPie({
  data,
  paramName,
  activeValue,
}: {
  data: CategoryAmount[];
  paramName: "drillIncomeCategory" | "drillExpenseCategory";
  activeValue: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleClick(entry: { categoryId?: number | null }) {
    const value = categoryParamValue(entry.categoryId ?? null);
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(paramName) === value) {
      params.delete(paramName);
    } else {
      params.delete("drillMonth");
      params.delete("drillStatus");
      params.delete("drillCustomer");
      params.delete("drillIncomeCategory");
      params.delete("drillExpenseCategory");
      params.set(paramName, value);
    }
    router.push(`?${params.toString()}`);
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">
        Keine Daten vorhanden
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          dataKey="total"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={75}
          paddingAngle={2}
          style={{ cursor: "pointer" }}
          onClick={(entry) => handleClick(entry as { categoryId?: number | null })}
        >
          {data.map((entry) => {
            const isActive = activeValue === categoryParamValue(entry.categoryId);
            const isDimmed = activeValue !== null && !isActive;
            return (
              <Cell
                key={entry.categoryId ?? "none"}
                fill={entry.color}
                opacity={isDimmed ? 0.35 : 1}
                stroke={isActive ? "var(--color-foreground)" : undefined}
                strokeWidth={isActive ? 2 : undefined}
              />
            );
          })}
        </Pie>
        <Tooltip content={(props) => <CustomTooltip active={props.active} payload={props.payload} />} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => <span className="text-xs">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CategoryBreakdownChart({
  income,
  expenses,
}: {
  income: CategoryAmount[];
  expenses: CategoryAmount[];
}) {
  const searchParams = useSearchParams();
  const activeIncomeCategory = searchParams.get("drillIncomeCategory");
  const activeExpenseCategory = searchParams.get("drillExpenseCategory");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1 text-center">Einnahmen</p>
        <CategoryPie data={income} paramName="drillIncomeCategory" activeValue={activeIncomeCategory} />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1 text-center">Ausgaben</p>
        <CategoryPie data={expenses} paramName="drillExpenseCategory" activeValue={activeExpenseCategory} />
      </div>
    </div>
  );
}
