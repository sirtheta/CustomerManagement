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
  });

  it("audits delete and records the open time entries that lose their price", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const service = await db.prisma.service.create({ data: { name: "Montage", unit: "Hour", unitPrice: 90 } });
    const entry = (invoiceId: number | null) => ({
      customerId: customer.customerId, date: new Date("2026-06-01"), serviceId: service.id,
      name: "Montage", unit: "Hour" as const, quantity: 1, createdById: 1, invoiceId,
    });
    await db.prisma.workEntry.create({ data: entry(null) });

    await expect(deleteService(service.id)).rejects.toThrow("redirect /services?flash=service-deleted");

    const [row] = await audit();
    expect(row).toMatchObject({ action: "DELETE", entityId: service.id, entityRef: "Montage" });
    expect(JSON.parse(row.details ?? "{}")).toEqual({ openWorkEntries: 1 });
  });
});
