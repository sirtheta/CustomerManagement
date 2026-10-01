import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { fetchJournal, journalCsv } from "@/lib/journal";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const parsedYear = yearParam ? parseInt(yearParam, 10) : NaN;
  const year = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();

  const journal = await fetchJournal(prisma, year);
  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(journalCsv(journal), `accounting-${today}.csv`);
}
