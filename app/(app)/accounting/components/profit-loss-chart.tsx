"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { MonthlyResult } from "../lib/income-statement-queries";

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: unknown;
  label?: string;
}) {
  if (!active) return null;
  const items = Array.isArray(payload)
    ? (payload as Array<{ name: string; value: number; color: string }>)
    : [];
  if (!items.length) return null;
  return (
    <div className="rounded-lg border bg-card p-2 text-xs shadow-md space-y-1">
      <p className="font-medium">{label}</p>
      {items.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}: {formatCurrency(item.value)}
        </p>
      ))}
    </div>
  );
}

export function ProfitLossChart({ data }: { data: MonthlyResult[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
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
        <Legend
          iconType="square"
          iconSize={8}
          formatter={(value: string) => <span className="text-xs">{value}</span>}
        />
        <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1} />
        <Bar
          dataKey="income"
          name="Einnahmen"
          fill="var(--color-chart-3)"
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        />
        <Bar
          dataKey="expenses"
          name="Ausgaben"
          fill="var(--color-chart-5)"
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        />
        <Line
          type="monotone"
          dataKey="net"
          name="Ergebnis"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={{ fill: "var(--color-chart-1)", r: 3 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
