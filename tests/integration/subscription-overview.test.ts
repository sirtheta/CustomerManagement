import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { listSubscriptionOverview } from "@/lib/subscription-overview";

describe("listSubscriptionOverview", () => {
  const db = createTestDatabase();

  async function seed(opts: {
    nextInvoiceDate: string;
    active?: boolean;
    archived?: boolean;
    templateId?: number | null;
    autoSend?: boolean;
    interval?: "Monthly" | "Quarterly" | "Yearly";
    customer?: Partial<Prisma.CustomerUncheckedCreateInput>;
  }) {
    const customer = await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        archivedAt: opts.archived ? new Date() : null,
        ...opts.customer,
      },
    });
    return db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: opts.templateId ?? null,
        interval: opts.interval ?? "Yearly",
        nextInvoiceDate: new Date(opts.nextInvoiceDate),
        active: opts.active ?? true,
        autoSend: opts.autoSend ?? false,
      },
    });
  }

  it("returns an empty list without subscriptions", async () => {
    expect(await listSubscriptionOverview(db.prisma)).toEqual([]);
  });

  it("sorts by next invoice date ascending", async () => {
    const late = await seed({ nextInvoiceDate: "2027-06-01" });
    const early = await seed({ nextInvoiceDate: "2027-01-01" });
    const middle = await seed({ nextInvoiceDate: "2027-03-01" });

    const rows = await listSubscriptionOverview(db.prisma);

    expect(rows.map((r) => r.id)).toEqual([early.id, middle.id, late.id]);
  });

  it("keeps paused subscriptions but lists them after the active ones", async () => {
    const pausedEarly = await seed({ nextInvoiceDate: "2027-01-01", active: false });
    const active = await seed({ nextInvoiceDate: "2027-09-01" });

    const rows = await listSubscriptionOverview(db.prisma);

    expect(rows.map((r) => r.id)).toEqual([active.id, pausedEarly.id]);
    expect(rows[1].active).toBe(false);
  });

  it("omits subscriptions of archived customers", async () => {
    await seed({ nextInvoiceDate: "2027-01-01", archived: true });
    const visible = await seed({ nextInvoiceDate: "2027-02-01" });

    const rows = await listSubscriptionOverview(db.prisma);

    expect(rows.map((r) => r.id)).toEqual([visible.id]);
  });

  it("lists every subscription of a customer as its own row", async () => {
    const first = await seed({ nextInvoiceDate: "2027-01-01", interval: "Monthly" });
    const second = await db.prisma.subscription.create({
      data: {
        customerId: first.customerId,
        interval: "Yearly",
        nextInvoiceDate: new Date("2027-05-01"),
      },
    });

    const rows = await listSubscriptionOverview(db.prisma);

    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows[0].customerId).toBe(rows[1].customerId);
  });

  it("maps customer name, template and flags, and formats the date", async () => {
    const template = await db.prisma.invoiceTemplate.create({ data: { name: "Mitgliederbeitrag" } });
    await seed({
      nextInvoiceDate: "2027-01-15",
      templateId: template.id,
      autoSend: true,
      interval: "Quarterly",
      customer: { company: "Muster AG", contactPerson: "Hans Muster" },
    });

    const [row] = await listSubscriptionOverview(db.prisma);

    expect(row).toMatchObject({
      customerName: "Muster AG",
      interval: "Quarterly",
      nextInvoiceDate: "2027-01-15",
      autoSend: true,
      active: true,
      templateId: template.id,
      templateName: "Mitgliederbeitrag",
    });
  });

  it("uses the contact person when the customer is a private person", async () => {
    await seed({
      nextInvoiceDate: "2027-01-15",
      customer: { company: "Ignoriert AG", contactPerson: "Anna Privat", contactInsteadOfCompany: true },
    });

    const [row] = await listSubscriptionOverview(db.prisma);

    expect(row.customerName).toBe("Anna Privat");
  });

  it("reports a missing template as null", async () => {
    await seed({ nextInvoiceDate: "2027-01-15", templateId: null });

    const [row] = await listSubscriptionOverview(db.prisma);

    expect(row.templateId).toBeNull();
    expect(row.templateName).toBeNull();
  });
});
