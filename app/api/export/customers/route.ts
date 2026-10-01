import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { UserRole } from "@prisma/client";
import { INTERVAL_LABELS } from "@/lib/subscription-dates";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === UserRole.Viewer) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const customers = await prisma.customer.findMany({
    orderBy: { contactPerson: "asc" },
    include: { subscriptions: { where: { active: true }, select: { interval: true } } },
  });

  const headers = ["ID", "Firma", "Kontaktperson", "Strasse", "Hausnummer", "PLZ", "Ort", "Land", "E-Mail", "Telefon", "Abos"];
  const rows = customers.map((c) => [
    c.customerId,
    c.company ?? "",
    c.contactPerson,
    c.street,
    c.houseNumber ?? "",
    c.zipCode,
    c.city,
    c.country,
    c.email,
    c.phone ?? "",
    [...new Set(c.subscriptions.map((s) => INTERVAL_LABELS[s.interval]))].join(", "),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, rows), `kunden-${today}.csv`);
}
