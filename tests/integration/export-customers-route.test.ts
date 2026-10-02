import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { INTERVAL_LABELS } from "@/lib/subscription-dates";

const holder = vi.hoisted(() => ({ prisma: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy({}, { get: (_t, key) => holder.prisma[key as string] }),
}));

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));

import { GET } from "@/app/api/export/customers/route";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

describe("GET /api/export/customers", () => {
  const db = createTestDatabase();
  beforeAll(() => {
    holder.prisma = db.prisma as unknown as Record<string, unknown>;
  });

  it("rejects a viewer", async () => {
    currentSession = sessionFor("Viewer");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lists distinct active subscription intervals in the Abos column", async () => {
    currentSession = sessionFor("Editor");
    const date = new Date(2027, 0, 1);
    const withSubs = await db.prisma.customer.create({
      data: { ...createValidTestCustomer(), contactPerson: "A Mit Abos", email: "a@example.ch" },
    });
    await db.prisma.customer.create({
      data: { ...createValidTestCustomer(), contactPerson: "B Ohne Abo", email: "b@example.ch" },
    });
    await db.prisma.subscription.createMany({
      data: [
        { customerId: withSubs.customerId, interval: "Monthly", nextInvoiceDate: date },
        { customerId: withSubs.customerId, interval: "Monthly", nextInvoiceDate: date },
        { customerId: withSubs.customerId, interval: "Yearly", nextInvoiceDate: date },
        { customerId: withSubs.customerId, interval: "Quarterly", nextInvoiceDate: date, active: false },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const [header, ...lines] = (await res.text()).split("\n");
    expect(header.endsWith(",Abos")).toBe(true);
    expect(lines[0]).toContain("A Mit Abos");
    expect(lines[0].endsWith(`"${INTERVAL_LABELS.Monthly}, ${INTERVAL_LABELS.Yearly}"`)).toBe(true);
    expect(lines[0]).not.toContain(INTERVAL_LABELS.Quarterly);
    expect(lines[1]).toContain("B Ohne Abo");
    expect(lines[1].endsWith(",")).toBe(true);
  });

  it("exports customer number, UID, billing data, payment term and contacts", async () => {
    currentSession = sessionFor("Editor");
    await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        contactPerson: "Extended",
        email: "ext@example.ch",
        customerNumber: 1042,
        uid: "CHE-116.281.710",
        paymentTermDays: 10,
        billingName: "Muster AG, Buchhaltung",
        billingStreet: "Postfach",
        billingHouseNumber: "7",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
        billingEmail: "buchhaltung@example.ch",
        contacts: {
          create: [
            { name: "Buchhaltung", role: "Buchhaltung", email: "b@x.ch" },
            { name: "Einkauf", email: "e@x.ch" },
          ],
        },
      },
    });

    const res = await GET();
    const [header, line] = (await res.text()).split("\n");
    expect(header).toBe(
      "ID,Kunden-Nr.,Firma,Kontaktperson,Strasse,Hausnummer,PLZ,Ort,Land,E-Mail,Telefon,UID," +
        "Zahlungsfrist (Tage),Rechnungsname,Rechnungsstrasse,Rechnungs-PLZ,Rechnungsort,Rechnungsland," +
        "Rechnungs-E-Mail,Weitere Kontakte,Abos"
    );
    expect(line).toContain(",1042,");
    expect(line).toContain("CHE-116.281.710");
    expect(line).toContain("Postfach 7");
    expect(line).toContain("buchhaltung@example.ch");
    expect(line).toContain("Buchhaltung (Buchhaltung) <b@x.ch>; Einkauf <e@x.ch>");
  });
});
