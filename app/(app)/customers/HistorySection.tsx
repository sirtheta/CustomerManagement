import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { HistoryEvent, HistoryKind } from "@/lib/customer-history";

const kindLabels: Record<HistoryKind, string> = {
  invoice: "Rechnung",
  quote: "Offerte",
  sent: "Versand",
  payment: "Zahlung",
  note: "Notiz",
  task: "Aufgabe",
  customer: "Kunde",
};

export default function HistorySection({ events }: { events: HistoryEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verlauf</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Aktivitäten.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li key={i} className="py-2 flex items-baseline gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{formatDate(e.date)}</span>
                <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                  {kindLabels[e.kind]}
                </span>
                {e.href ? (
                  <Link href={e.href} className="hover:underline">
                    {e.text}
                  </Link>
                ) : (
                  <span>{e.text}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
