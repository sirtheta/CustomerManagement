import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

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

import { createWorkEntry, deleteWorkEntry, updateWorkEntry } from "@/app/(app)/time/actions";
import { CUSTOMER_ARCHIVED_ERROR } from "@/lib/customer-archive";

const editor = { user: { id: "2", name: "Editor", email: "e@test.ch", role: "Editor" }, expires: "2099-01-01" } as Session;
const viewer = { user: { id: "3", name: "Viewer", email: "v@test.ch", role: "Viewer" }, expires: "2099-01-01" } as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("work entry actions", () => {
  const db = createTestDatabase();
  let customerId: number;
  let hourServiceId: number;
  let pieceServiceId: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = editor;
    customerId = (await db.prisma.customer.create({ data: createValidTestCustomer() })).customerId;
    hourServiceId = (await db.prisma.service.create({ data: { name: "Gartenpflege", unit: "Hour", unitPrice: 70 } })).id;
    pieceServiceId = (await db.prisma.service.create({ data: { name: "Rindenmulch", unit: "Piece", unitPrice: 12 } })).id;
  });

  const timeForm = (extra: Record<string, string> = {}) =>
    form({ customerId: String(customerId), date: "2026-10-12", serviceId: String(hourServiceId), quantity: "2,5", ...extra });

  it("creates a time entry from a catalog service and audits it", async () => {
    const result = await createWorkEntry({}, timeForm({ note: " Hecke " }));

    expect(result.success).toBe(true);
    const entry = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: result.entryId! } });
    expect(entry).toMatchObject({ customerId, serviceId: hourServiceId, name: "Gartenpflege", unit: "Hour", note: "Hecke", createdById: 2, invoiceId: null });
    expect(Number(entry.quantity)).toBe(2.5);
    expect(entry.date.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { entityType: "WorkEntry", action: "CREATE" } });
    expect(audit.entityId).toBe(entry.id);
  });

  it("creates free-text material but refuses free-text time", async () => {
    const material = await createWorkEntry(
      {},
      form({ customerId: String(customerId), date: "2026-10-12", serviceId: "", freeName: "Kies 8/16", freeUnit: "Package", quantity: "1" })
    );
    expect(material.success).toBe(true);

    const time = await createWorkEntry(
      {},
      form({ customerId: String(customerId), date: "2026-10-12", serviceId: "", freeName: "Arbeit", freeUnit: "Hour", quantity: "1" })
    );
    expect(time.error).toBe("Freie Eingabe ist nur für Material möglich.");
    expect(await db.prisma.workEntry.count()).toBe(1);
  });

  it("takes name and unit from the service even if the client sends others", async () => {
    const result = await createWorkEntry({}, timeForm({ serviceId: String(pieceServiceId), freeName: "Hack", freeUnit: "Hour", quantity: "3" }));
    const entry = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: result.entryId! } });
    expect(entry).toMatchObject({ name: "Rindenmulch", unit: "Piece" });
  });

  it("refuses an inactive service, a bad quantity and a bad date", async () => {
    await db.prisma.service.update({ where: { id: hourServiceId }, data: { isActive: false } });
    expect((await createWorkEntry({}, timeForm())).error).toBe("Die Leistung ist nicht mehr aktiv.");
    expect((await createWorkEntry({}, timeForm({ serviceId: String(pieceServiceId), quantity: "0" }))).error).toMatch(/grösser als 0/);
    expect((await createWorkEntry({}, timeForm({ date: "2026-02-30" }))).error).toBe("Bitte Kunde und Datum angeben.");
    expect(await db.prisma.workEntry.count()).toBe(0);
  });

  it("refuses an archived customer", async () => {
    await db.prisma.customer.update({ where: { customerId }, data: { archivedAt: new Date() } });
    expect((await createWorkEntry({}, timeForm())).error).toBe(CUSTOMER_ARCHIVED_ERROR);
  });

  it("redirects viewers and writes nothing", async () => {
    holder.session = viewer;
    await expect(createWorkEntry({}, timeForm())).rejects.toThrow("redirect /dashboard");
    expect(await db.prisma.workEntry.count()).toBe(0);
  });

  it("updates date, quantity and note of an open entry", async () => {
    const { entryId } = await createWorkEntry({}, timeForm());
    const result = await updateWorkEntry(entryId!, {}, form({ date: "2026-10-13", quantity: "4", note: "" }));
    expect(result.success).toBe(true);
    const entry = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: entryId! } });
    expect(Number(entry.quantity)).toBe(4);
    expect(entry.note).toBeNull();
    expect(entry.date.toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("stores the quantity of an update rounded to two decimals", async () => {
    const { entryId } = await createWorkEntry({}, timeForm({ serviceId: String(pieceServiceId), quantity: "1" }));
    const result = await updateWorkEntry(entryId!, {}, form({ date: "2026-10-12", quantity: "2.000000000001", note: "" }));
    expect(result.success).toBe(true);
    const entry = await db.prisma.workEntry.findUniqueOrThrow({ where: { id: entryId! } });
    expect(Number(entry.quantity)).toBe(2);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { entityType: "WorkEntry", action: "UPDATE" } });
    expect(JSON.parse(audit.details!).quantity).toBe(2);
  });

  it("validates the quantity of an update against the entry's unit", async () => {
    const { entryId } = await createWorkEntry({}, timeForm());
    expect((await updateWorkEntry(entryId!, {}, form({ date: "2026-10-12", quantity: "30", note: "" }))).error).toMatch(/24 Stunden/);
  });

  it("locks billed entries against update and delete, also from a stale tab", async () => {
    const { entryId } = await createWorkEntry({}, timeForm());
    const invoice = await db.prisma.invoice.create({
      data: { customerId, date: new Date("2026-10-14"), dueDate: new Date("2026-11-14"), totalAmount: 0, state: "Draft" },
    });
    await db.prisma.workEntry.update({ where: { id: entryId! }, data: { invoiceId: invoice.id } });

    const billed = "Der Eintrag ist bereits verrechnet oder existiert nicht mehr.";
    expect((await updateWorkEntry(entryId!, {}, form({ date: "2026-10-12", quantity: "1", note: "" }))).error).toBe(billed);
    expect(await deleteWorkEntry(entryId!)).toEqual({ error: billed });
    expect(await db.prisma.workEntry.count()).toBe(1);
  });

  it("deletes an open entry and audits it", async () => {
    const { entryId } = await createWorkEntry({}, timeForm());
    expect(await deleteWorkEntry(entryId!)).toEqual({});
    expect(await db.prisma.workEntry.count()).toBe(0);
    expect(await db.prisma.auditLog.count({ where: { entityType: "WorkEntry", action: "DELETE" } })).toBe(1);
  });
});
