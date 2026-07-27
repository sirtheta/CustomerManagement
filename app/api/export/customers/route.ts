import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === UserRole.Viewer) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const customers = await prisma.customer.findMany({
    orderBy: { contactPerson: "asc" },
  });

  const headers = ["ID", "Firma", "Kontaktperson", "Adresse", "PLZ", "Ort", "E-Mail", "Telefon", "Jahresrechnung"];
  const rows = customers.map((c) => [
    c.customerId,
    c.company ?? "",
    c.contactPerson,
    c.address,
    c.zipCode,
    c.city,
    c.email,
    c.phone ?? "",
    c.yearlyInvoice ? "Ja" : "Nein",
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, rows), `kunden-${today}.csv`);
}
