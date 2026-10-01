import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { fetchReceivables } from "@/lib/receivables";
import { receivablesCsv } from "@/lib/receivables-csv";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const raw = new URL(request.url).searchParams.get("asOf");
  const parsed = raw ? new Date(`${raw}T23:59:59.999Z`) : null;
  const now = new Date();
  const asOf =
    parsed && !isNaN(parsed.getTime())
      ? parsed
      : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

  const report = await fetchReceivables(prisma, asOf);
  return csvResponse(receivablesCsv(report), `offene-posten-${asOf.toISOString().slice(0, 10)}.csv`);
}
