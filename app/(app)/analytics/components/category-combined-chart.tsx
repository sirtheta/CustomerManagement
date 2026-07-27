"use client";

import {
  BarChart,
  Bar,
  Rectangle,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { categoryParamValue } from "../lib/analytics-utils";
import type { CategoryCombined } from "../lib/analytics-queries";

function CustomTooltip({ active, payload }: { active?: boolean; payload?: unknown }) {
  if (!active) return null;
  const items = Array.isArray(payload) ? (payload as Array<{ payload: CategoryCombined }>) : [];
  if (!items.length) return null;
  const d = items[0].payload;
  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{d.name}</p>
      <p>Einnahmen: {formatCurrency(d.income)}</p>
      <p>Ausgaben: {formatCurrency(d.expense)}</p>
      <p className="font-medium mt-1">Netto: {formatCurrency(d.income - d.expense)}</p>
      <p className="text-muted-foreground mt-1">Klicken für Details</p>
    </div>
  );
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function CategoryCombinedChart({ data }: { data: CategoryCombined[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeValue = searchParams.get("drillCombinedCategory");

  function handleClick(entry: CategoryCombined) {
    const value = categoryParamValue(entry.categoryId);
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("drillCombinedCategory") === value) {
      params.delete("drillCombinedCategory");
    } else {
      params.delete("drillMonth");
      params.delete("drillStatus");
      params.delete("drillCustomer");
      params.delete("drillIncomeCategory");
      params.delete("drillExpenseCategory");
      params.set("drillCombinedCategory", value);
    }
    router.push(`?${params.toString()}`);
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        Keine Daten vorhanden
      </div>
    );
  }

  const chartData = data.map((d) => ({ ...d, name: truncate(d.name, 18) }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 36)}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip
          content={(props) => <CustomTooltip active={props.active} payload={props.payload} />}
          cursor={{ fill: "var(--color-accent)" }}
        />
        <Legend
          iconType="circle"
          iconSize={12}
          formatter={(value: string) => (
            <span className="text-xs">{value === "income" ? "Einnahmen" : "Ausgaben"}</span>
          )}
        />
        <Bar
          dataKey="income"
          stackId="total"
          fill="var(--color-chart-1)"
          radius={[0, 0, 0, 0]}
          maxBarSize={20}
          style={{ cursor: "pointer" }}
          onClick={(data) => handleClick(data as unknown as CategoryCombined)}
          shape={(props: unknown) => {
            const p = props as { categoryId?: number | null };
            const isActive = activeValue === categoryParamValue(p.categoryId ?? null);
            return <Rectangle {...(props as object)} fill="var(--color-chart-1)" opacity={activeValue !== null && !isActive ? 0.35 : 1} />;
          }}
        />
        <Bar
          dataKey="expense"
          stackId="total"
          fill="var(--color-chart-3)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
          style={{ cursor: "pointer" }}
          onClick={(data) => handleClick(data as unknown as CategoryCombined)}
          shape={(props: unknown) => {
            const p = props as { categoryId?: number | null };
            const isActive = activeValue === categoryParamValue(p.categoryId ?? null);
            return <Rectangle {...(props as object)} fill="var(--color-chart-3)" opacity={activeValue !== null && !isActive ? 0.35 : 1} />;
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
