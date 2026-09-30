import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { documentLabel } from "@/lib/document-display";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { AGE_BUCKETS, fetchReceivables } from "@/lib/receivables";

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
  const headers = [
    "Rechnung", "Kunde", "Rechnungsdatum", "Fällig", "Total (CHF)",
    "Bezahlt (CHF)", "Offen (CHF)", "Guthaben (CHF)", "Alter",
  ];
  const rows = report.rows.map((r) => [
    documentLabel(r.documentNumber),
    r.customerName,
    r.date.toLocaleDateString("de-CH"),
    r.dueDate.toLocaleDateString("de-CH"),
    (r.totalRappen / 100).toFixed(2),
    (r.paidRappen / 100).toFixed(2),
    (r.openRappen / 100).toFixed(2),
    (r.creditRappen / 100).toFixed(2),
    AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? "",
  ]);

  return csvResponse(buildCsv(headers, rows), `offene-posten-${asOf.toISOString().slice(0, 10)}.csv`);
}
