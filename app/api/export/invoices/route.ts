import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { InvoiceState, UserRole } from "@prisma/client";
import { z } from "zod";

const stateLabels: Record<string, string> = {
  Draft: "Entwurf",
  Sent: "Versendet",
  Paid: "Bezahlt",
  Overdue: "Überfällig",
  Canceled: "Storniert",
};

const querySchema = z.object({
  state: z.nativeEnum(InvoiceState).optional(),
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

  const invoices = await prisma.invoice.findMany({
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

  const headers = ["Nummer", "Datum", "Fälligkeit", "Kunde", "Betrag (CHF)", "Status"];
  const rows = invoices.map((inv) => [
    inv.documentNumber,
    inv.date.toLocaleDateString("de-CH"),
    inv.dueDate.toLocaleDateString("de-CH"),
    inv.customer.contactInsteadOfCompany
      ? inv.customer.contactPerson
      : (inv.customer.company || inv.customer.contactPerson),
    inv.totalAmount.toNumber().toFixed(2),
    stateLabels[inv.state] ?? inv.state,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, rows), `rechnungen-${today}.csv`);
}
