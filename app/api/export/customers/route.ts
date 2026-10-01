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
    include: {
      subscriptions: { where: { active: true }, select: { interval: true } },
      contacts: { orderBy: [{ createdAt: "asc" }, { contactId: "asc" }] },
    },
  });

  const headers = [
    "ID", "Kunden-Nr.", "Firma", "Kontaktperson", "Strasse", "Hausnummer", "PLZ", "Ort", "Land",
    "E-Mail", "Telefon", "UID", "Zahlungsfrist (Tage)", "Rechnungsname", "Rechnungsstrasse",
    "Rechnungs-PLZ", "Rechnungsort", "Rechnungsland", "Rechnungs-E-Mail", "Weitere Kontakte", "Abos",
  ];
  const rows = customers.map((c) => [
    c.customerId,
    c.customerNumber ?? "",
    c.company ?? "",
    c.contactPerson,
    c.street,
    c.houseNumber ?? "",
    c.zipCode,
    c.city,
    c.country,
    c.email,
    c.phone ?? "",
    c.uid ?? "",
    c.paymentTermDays ?? "",
    c.billingName ?? "",
    [c.billingStreet, c.billingHouseNumber].filter(Boolean).join(" "),
    c.billingZipCode ?? "",
    c.billingCity ?? "",
    c.billingCountry ?? "",
    c.billingEmail ?? "",
    c.contacts
      .map((k) => `${k.name}${k.role ? ` (${k.role})` : ""}${k.email ? ` <${k.email}>` : ""}`)
      .join("; "),
    [...new Set(c.subscriptions.map((s) => INTERVAL_LABELS[s.interval]))].join(", "),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(buildCsv(headers, rows), `kunden-${today}.csv`);
}
