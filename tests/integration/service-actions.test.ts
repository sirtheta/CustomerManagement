import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// Service actions against a real database: every mutation is audited, and deleting a
// service records how many open time entries lose their catalog price (SET NULL).
const holder = vi.hoisted(() => ({ prisma: null as unknown, session: null as Session | null }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => holder.session) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect ${url}`);
  }),
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}));

import { createService, updateService, deleteService } from "@/app/(app)/services/actions";

function serviceForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("service actions (real database)", () => {
  const db = createTestDatabase();

  beforeEach(() => {
    holder.prisma = db.prisma;
    holder.session = { user: { id: "1", name: "Admin", email: "a@test.ch", role: "Admin" }, expires: "2099-01-01" } as Session;
  });

  const audit = () => db.prisma.auditLog.findMany({ where: { entityType: "Service" }, orderBy: { id: "asc" } });

  it("audits create and update", async () => {
    await expect(
      createService({}, serviceForm({ name: "Beratung", unit: "Hour", unitPrice: "120", isActive: "on" }))
    ).rejects.toThrow("redirect /services?flash=service-created");
    const service = await db.prisma.service.findFirstOrThrow();

    await expect(
      updateService(service.id, {}, serviceForm({ name: "Beratung Plus", unit: "Hour", unitPrice: "130", isActive: "on" }))
    ).rejects.toThrow("redirect /services?flash=service-updated");

    const rows = await audit();
    expect(rows.map((r) => [r.action, r.entityId, r.entityRef])).toEqual([
      ["CREATE", service.id, "Beratung"],
      ["UPDATE", service.id, "Beratung Plus"],
    ]);
    // The price is billing-relevant: the old and the new value are kept
    expect(JSON.parse(rows[1].details ?? "{}")).toEqual({ unitPrice: { from: 120, to: 130 } });
  });

  it("records only the fields that changed (unit, no price) and nothing when neither did", async () => {
    const service = await db.prisma.service.create({ data: { name: "Montage", unit: "Hour", unitPrice: 90 } });

    await expect(
      updateService(service.id, {}, serviceForm({ name: "Montage", unit: "Day", unitPrice: "90.00", isActive: "on" }))
    ).rejects.toThrow("redirect /services?flash=service-updated");
    await expect(
      updateService(service.id, {}, serviceForm({ name: "Montage neu", unit: "Day", unitPrice: "90", isActive: "on" }))
    ).rejects.toThrow("redirect /services?flash=service-updated");

    const rows = await audit();
    expect(JSON.parse(rows[0].details ?? "null")).toEqual({ unit: { from: "Hour", to: "Day" } });
    expect(rows[1].details).toBeNull();
  });

  it("refuses a Viewer on createService and an Editor on deleteService without an audit entry", async () => {
    holder.session = { user: { id: "2", name: "Leser", email: "v@test.ch", role: "Viewer" }, expires: "2099-01-01" } as Session;
    await expect(
      createService({}, serviceForm({ name: "Beratung", unit: "Hour", unitPrice: "120", isActive: "on" }))
    ).rejects.toThrow("redirect /dashboard");
    expect(await db.prisma.service.count()).toBe(0);

    const service = await db.prisma.service.create({ data: { name: "Montage", unit: "Hour", unitPrice: 90 } });
    holder.session = { user: { id: "3", name: "Bearbeiter", email: "e@test.ch", role: "Editor" }, expires: "2099-01-01" } as Session;
    await expect(deleteService(service.id)).rejects.toThrow("redirect /dashboard");

    expect(await db.prisma.service.findUnique({ where: { id: service.id } })).not.toBeNull();
    expect(await audit()).toEqual([]);
  });

  it("audits delete and records the open time entries that lose their price", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const service = await db.prisma.service.create({ data: { name: "Montage", unit: "Hour", unitPrice: 90 } });
    const entry = (invoiceId: number | null) => ({
      customerId: customer.customerId, date: new Date("2026-06-01"), serviceId: service.id,
      name: "Montage", unit: "Hour" as const, quantity: 1, createdById: 1, invoiceId,
    });
    await db.prisma.workEntry.create({ data: entry(null) });
    // A billed entry keeps its invoice position and does not count
    const invoice = await db.prisma.invoice.create({
      data: { customerId: customer.customerId, date: new Date("2026-06-02"), dueDate: new Date("2026-07-02"), totalAmount: 90 },
    });
    await db.prisma.workEntry.create({ data: entry(invoice.id) });

    await expect(deleteService(service.id)).rejects.toThrow("redirect /services?flash=service-deleted");

    const [row] = await audit();
    expect(row).toMatchObject({ action: "DELETE", entityId: service.id, entityRef: "Montage" });
    expect(JSON.parse(row.details ?? "{}")).toEqual({ openWorkEntries: 1 });
  });
});
