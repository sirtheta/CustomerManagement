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
import type { MonthlyRevenue } from "../lib/analytics-queries";

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: unknown;
  label?: string;
}) {
  if (!active) return null;
  const items = Array.isArray(payload) ? (payload as Array<{ value: number }>) : [];
  if (!items.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-md">
      <p className="font-medium mb-1">{label}</p>
      <p>{formatCurrency(items[0].value)}</p>
      <p className="text-muted-foreground mt-1">Klicken für Details</p>
    </div>
  );
}

export function MonthlyRevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMonth = searchParams.get("drillMonth");

  function handleClick(entry: { monthIndex?: number }) {
    if (entry?.monthIndex === undefined) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("drillMonth") === String(entry.monthIndex)) {
      params.delete("drillMonth");
    } else {
      params.set("drillMonth", String(entry.monthIndex));
      params.delete("drillStatus");
      params.delete("drillCustomer");
      params.delete("drillIncomeCategory");
      params.delete("drillExpenseCategory");
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={data}
        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
        style={{ cursor: "pointer" }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          vertical={false}
        />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
          }
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <Tooltip
          content={(props) => (
            <CustomTooltip
              active={props.active}
              payload={props.payload}
              label={props.label as string | undefined}
            />
          )}
          cursor={{ fill: "var(--color-accent)" }}
        />
        <Bar
          dataKey="amount"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          onClick={(entry) => handleClick(entry as { monthIndex?: number })}
        >
          {data.map((entry) => {
            const isActive = activeMonth !== null && entry.monthIndex === Number(activeMonth);
            return (
              <Cell
                key={entry.monthIndex}
                fill={isActive ? "var(--color-chart-2)" : "var(--color-chart-1)"}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
