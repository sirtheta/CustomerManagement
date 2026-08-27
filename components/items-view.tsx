import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { Unit } from "@prisma/client";

export type ItemViewData = {
  id: number;
  name: string;
  description: string | null;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  totalAmount: number;
};

const unitLabels: Record<Unit, string> = {
  Hour: "Stunde",
  Day: "Tag",
  Piece: "Stück",
  Package: "Pauschal",
};

export default function ItemsView({ items }: { items: ItemViewData[] }) {
  if (items.length === 0) {
    return <p className="text-center text-gray-400 py-6">Keine Positionen.</p>;
  }

  return (
    <>
      {/* Mobile: Cards pro Position (analog zum Editor) */}
      <div className="space-y-3 sm:hidden">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={cn(
              "rounded-lg border p-3 space-y-1.5",
              i % 2 === 0 ? "" : "bg-muted/20"
            )}
          >
            <span className="text-xs font-medium text-muted-foreground">
              Position {i + 1}
            </span>
            <p className="font-medium text-sm">{item.name}</p>
            {item.description && (
              <p className="text-sm text-gray-500 whitespace-pre-wrap">
                {item.description}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-sm text-muted-foreground">
                {item.quantity} × {unitLabels[item.unit]} à{" "}
                {formatCurrency(item.unitPrice)}
              </span>
              <span className="text-sm font-semibold">
                {formatCurrency(item.totalAmount)}
              </span>
            </div>
            {(item.discountPercent ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">Rabatt: {item.discountPercent}%</p>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: Tabelle */}
      <div className="overflow-x-auto hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bezeichnung</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Einheit</TableHead>
              <TableHead className="text-right">Menge</TableHead>
              <TableHead className="text-right">Preis</TableHead>
              <TableHead className="text-right">Rabatt</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-gray-500">
                  {item.description ?? "—"}
                </TableCell>
                <TableCell>{unitLabels[item.unit]}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(item.unitPrice)}
                </TableCell>
                <TableCell className="text-right">
                  {(item.discountPercent ?? 0) > 0 ? `${item.discountPercent}%` : "—"}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(item.totalAmount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
