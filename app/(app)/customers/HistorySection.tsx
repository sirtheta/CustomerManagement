import { CardLink, ListRow } from "@/components/ui/list-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { HistoryEvent, HistoryKind } from "@/lib/customer-history";

const kindLabels: Record<HistoryKind, string> = {
  invoice: "Rechnung",
  creditNote: "Gutschrift",
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
            {events.map((e, i) => {
              const meta = (
                <>
                  <span className="w-24 shrink-0 text-muted-foreground">{formatDate(e.date)}</span>
                  <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                    {kindLabels[e.kind]}
                  </span>
                </>
              );
              // Events with a target are tappable as a whole row, the others stay plain text.
              return e.href ? (
                <ListRow key={i} className="py-2 flex items-baseline gap-3 text-sm">
                  {meta}
                  <CardLink href={e.href} className="hover:underline">
                    {e.text}
                  </CardLink>
                </ListRow>
              ) : (
                <li key={i} className="py-2 flex items-baseline gap-3 text-sm">
                  {meta}
                  <span>{e.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
