import type { PrismaClient } from "@prisma/client";
import { documentLabel } from "@/lib/document-display";
import { formatCurrency } from "@/lib/utils";

export type HistoryKind =
  | "invoice"
  | "creditNote"
  | "quote"
  | "sent"
  | "payment"
  | "note"
  | "task"
  | "customer";

export type HistoryEvent = {
  date: Date;
  kind: HistoryKind;
  text: string;
  href?: string;
};

/** Newest first; ties keep the order in which the sources were passed in. */
export function sortHistory(events: HistoryEvent[]): HistoryEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => b.event.date.getTime() - a.event.date.getTime() || a.index - b.index)
    .map(({ event }) => event);
}

const PER_SOURCE_LIMIT = 50;
const AUDIT_LABELS: Record<string, string> = {
  CREATE: "Kunde angelegt",
  UPDATE: "Kundendaten geändert",
  STATUS: "Kundenstatus geändert",
};

/**
 * Builds the customer timeline from data that already exists (documents, sent
 * logs, payments, notes, tasks and the audit entries of the customer itself).
 * Note contents are encrypted at rest, so only the title is shown. Quotes and
 * tasks are skipped while their module is switched off (the data stays).
 */
export async function loadCustomerHistory(
  prisma: PrismaClient,
  customerId: number,
  { quotes: withQuotes = true, tasks: withTasks = true, limit = 60 }: { quotes?: boolean; tasks?: boolean; limit?: number } = {}
): Promise<HistoryEvent[]> {
  const take = PER_SOURCE_LIMIT;
  const [invoices, quotes, invoiceLogs, quoteLogs, payments, notes, tasks, audits] = await Promise.all([
    prisma.invoice.findMany({
      where: { customerId },
      select: { id: true, documentNumber: true, date: true, creditNoteForId: true },
      orderBy: { date: "desc" },
      take,
    }),
    withQuotes
      ? prisma.quote.findMany({
          where: { customerId },
          select: { id: true, documentNumber: true, date: true },
          orderBy: { date: "desc" },
          take,
        })
      : [],
    prisma.invoiceSentLog.findMany({
      where: { invoice: { customerId } },
      select: { sentAt: true, sentTo: true, invoice: { select: { id: true, documentNumber: true, creditNoteForId: true } } },
      orderBy: { sentAt: "desc" },
      take,
    }),
    withQuotes
      ? prisma.quoteSentLog.findMany({
          where: { quote: { customerId } },
          select: { sentAt: true, sentTo: true, quote: { select: { id: true, documentNumber: true } } },
          orderBy: { sentAt: "desc" },
          take,
        })
      : [],
    prisma.payment.findMany({
      where: { invoice: { customerId } },
      select: { date: true, amount: true, invoice: { select: { id: true, documentNumber: true } } },
      orderBy: { date: "desc" },
      take,
    }),
    prisma.customerNote.findMany({
      where: { customerId },
      select: { title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
    withTasks
      ? prisma.task.findMany({
          where: { customerId },
          select: { title: true, createdAt: true, doneAt: true },
          orderBy: { createdAt: "desc" },
          take,
        })
      : [],
    prisma.auditLog.findMany({
      where: { entityType: "Customer", entityId: customerId, action: { in: Object.keys(AUDIT_LABELS) } },
      select: { action: true, userName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  const events: HistoryEvent[] = [
    ...invoices.map((i) => ({
      date: i.date,
      kind: i.creditNoteForId !== null ? ("creditNote" as const) : ("invoice" as const),
      text: `${i.creditNoteForId !== null ? "Gutschrift" : "Rechnung"} ${documentLabel(i.documentNumber)} erstellt`,
      href: `/invoices/${i.id}?from=customers/${customerId}`,
    })),
    ...quotes.map((q) => ({
      date: q.date,
      kind: "quote" as const,
      text: `Offerte ${documentLabel(q.documentNumber)} erstellt`,
      href: `/quotes/${q.id}?from=customers/${customerId}`,
    })),
    ...invoiceLogs.map((l) => ({
      date: l.sentAt,
      kind: "sent" as const,
      text: `${l.invoice.creditNoteForId !== null ? "Gutschrift" : "Rechnung"} ${documentLabel(l.invoice.documentNumber)} an ${l.sentTo} gesendet`,
      href: `/invoices/${l.invoice.id}?from=customers/${customerId}`,
    })),
    ...quoteLogs.map((l) => ({
      date: l.sentAt,
      kind: "sent" as const,
      text: `Offerte ${documentLabel(l.quote.documentNumber)} an ${l.sentTo} gesendet`,
      href: `/quotes/${l.quote.id}?from=customers/${customerId}`,
    })),
    ...payments.map((p) => ({
      date: p.date,
      kind: "payment" as const,
      text: `Zahlung ${formatCurrency(p.amount.toNumber())} zu ${documentLabel(p.invoice.documentNumber)}`,
      href: `/invoices/${p.invoice.id}?from=customers/${customerId}`,
    })),
    ...notes.map((n) => ({ date: n.createdAt, kind: "note" as const, text: `Notiz «${n.title}» angelegt` })),
    ...tasks.flatMap((t) => [
      { date: t.createdAt, kind: "task" as const, text: `Aufgabe «${t.title}» angelegt` },
      ...(t.doneAt ? [{ date: t.doneAt, kind: "task" as const, text: `Aufgabe «${t.title}» erledigt` }] : []),
    ]),
    ...audits.map((a) => ({
      date: a.createdAt,
      kind: "customer" as const,
      text: `${AUDIT_LABELS[a.action]} (${a.userName})`,
    })),
  ];
  return sortHistory(events).slice(0, limit);
}
