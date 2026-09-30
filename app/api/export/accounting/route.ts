import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { documentLabel } from "@/lib/document-display";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";

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

  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      include: { invoice: { select: { documentNumber: true } } },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      include: { category: { select: { name: true } } },
    }),
  ]);

  type Row = { date: Date; type: "Einnahme" | "Ausgabe"; description: string; category: string; amount: number };

  const rows: Row[] = [
    ...payments.map((p) => ({
      date: p.date,
      type: "Einnahme" as const,
      description: documentLabel(p.invoice.documentNumber),
      category: "",
      amount: p.amount.toNumber(),
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
