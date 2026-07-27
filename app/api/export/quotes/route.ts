import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { QuoteState, UserRole } from "@prisma/client";
import { z } from "zod";

const stateLabels: Record<string, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Accepted: "Angenommen",
  Declined: "Abgelehnt",
  Expired: "Abgelaufen",
};

const querySchema = z.object({
  state: z.nativeEnum(QuoteState).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === UserRole.Viewer) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    state: url.searchParams.get("state") ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const { state, dateFrom, dateTo } = parsed.data;

  const quotes = await prisma.quote.findMany({
    where: {
      ...(state ? { state } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo + "T23:59:59") } : {}),
            },
          }
        : {}),
    },
    include: { customer: true },
    orderBy: { date: "desc" },
  });

  const headers = ["Nummer", "Datum", "Gültig bis", "Kunde", "Betrag (CHF)", "Status"];
  const rows = quotes.map((q) => [
    q.documentNumber,
    q.date.toLocaleDateString("de-CH"),
    q.validUntil.toLocaleDateString("de-CH"),
    q.customer.contactInsteadOfCompany
      ? q.customer.contactPerson
      : (q.customer.company || q.customer.contactPerson),
    q.totalAmount.toNumber().toFixed(2),
    stateLabels[q.state] ?? q.state,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, rows), `offerten-${today}.csv`);
}
