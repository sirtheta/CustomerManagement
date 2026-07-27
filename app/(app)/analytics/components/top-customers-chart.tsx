"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import type { TopCustomer } from "../lib/analytics-queries";

function CustomTooltip({ active, payload }: { active?: boolean; payload?: unknown }) {
  if (!active) return null;
  const items = Array.isArray(payload)
    ? (payload as Array<{ value: number; payload: TopCustomer }>)
    : [];
  if (!items.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{items[0].payload.name}</p>
      <p>{formatCurrency(items[0].value)}</p>
      <p className="text-muted-foreground mt-1">Klicken für Details</p>
    </div>
  );
}

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function TopCustomersChart({ data }: { data: TopCustomer[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCustomer = searchParams.get("drillCustomer");

  function handleClick(entry: { customerId?: number }) {
    if (entry?.customerId === undefined) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("drillCustomer") === String(entry.customerId)) {
      params.delete("drillCustomer");
    } else {
      params.set("drillCustomer", String(entry.customerId));
      params.delete("drillMonth");
      params.delete("drillStatus");
      params.delete("drillIncomeCategory");
      params.delete("drillExpenseCategory");
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

  const chartData = data.map((d) => ({ ...d, name: truncate(d.name, 18) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
        style={{ cursor: "pointer" }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
          }
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
          content={(props) => (
            <CustomTooltip active={props.active} payload={props.payload} />
          )}
          cursor={{ fill: "var(--color-accent)" }}
        />
        <Bar
          dataKey="total"
          radius={[0, 4, 4, 0]}
          maxBarSize={32}
          onClick={(entry) => handleClick(entry as { customerId?: number })}
        >
          {chartData.map((entry) => (
            <Cell
              key={entry.customerId}
              fill={
                activeCustomer === String(entry.customerId)
                  ? "var(--color-chart-1)"
                  : "var(--color-chart-2)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
