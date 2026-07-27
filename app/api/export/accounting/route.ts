import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { InvoiceState, UserRole } from "@prisma/client";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const parsedYear = yearParam ? parseInt(yearParam, 10) : NaN;
  const year = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [paidInvoices, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { state: InvoiceState.Paid, paidDate: { gte: yearStart, lt: yearEnd } },
      include: { customer: true },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      include: { category: { select: { name: true } } },
    }),
  ]);

  type Row = { date: Date; type: "Einnahme" | "Ausgabe"; description: string; category: string; amount: number };

  const rows: Row[] = [
    ...paidInvoices.map((inv) => ({
      date: inv.paidDate!,
      type: "Einnahme" as const,
      description: inv.documentNumber,
      category: "",
      amount: inv.totalAmount.toNumber(),
    })),
    ...expenses.map((exp) => ({
      date: exp.date,
      type: "Ausgabe" as const,
      description: exp.description,
      category: exp.category?.name ?? "",
      amount: exp.amount.toNumber(),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const headers = ["Datum", "Typ", "Bezeichnung", "Kategorie", "Betrag (CHF)"];
  const csvRows = rows.map((r) => [
    r.date.toLocaleDateString("de-CH"),
    r.type,
    r.description,
    r.category,
    r.amount.toFixed(2),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, csvRows), `accounting-${today}.csv`);
}
