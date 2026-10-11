import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { listOpenWork } from "@/lib/work-overview";

describe("listOpenWork", () => {
  const db = createTestDatabase();

  const add = (customerId: number, data: object) =>
    db.prisma.workEntry.create({
      data: { customerId, createdById: 1, date: new Date("2026-10-12T00:00:00.000Z"), name: "x", unit: "Hour", quantity: 1, ...data },
    });

  it("summarises the open entries per customer and ignores billed ones", async () => {
    const a = (await db.prisma.customer.create({ data: { ...createValidTestCustomer(), company: "Zeta AG" } })).customerId;
    const b = (await db.prisma.customer.create({ data: { ...createValidTestCustomer(), company: "Alpha AG" } })).customerId;
    const invoice = await db.prisma.invoice.create({
      data: { customerId: a, date: new Date("2026-10-01"), dueDate: new Date("2026-10-31"), totalAmount: 0, state: "Draft" },
    });
    await add(a, { quantity: 2.5 });
    await add(a, { quantity: 1, date: new Date("2026-10-05T00:00:00.000Z") });
    await add(a, { unit: "Day", quantity: 1 });
    await add(a, { unit: "Piece", quantity: 4 });
    await add(a, { quantity: 9, invoiceId: invoice.id });
    await add(b, { unit: "Package", quantity: 1 });

    const rows = await listOpenWork(db.prisma);

    expect(rows.map((r) => r.customerName)).toEqual(["Alpha AG", "Zeta AG"]);
    expect(rows[1]).toEqual({
      customerId: a,
      customerName: "Zeta AG",
      archived: false,
      entryCount: 4,
      hours: 3.5,
      days: 1,
      materialCount: 1,
      oldest: "2026-10-05",
    });
    expect(rows[0]).toMatchObject({ entryCount: 1, hours: 0, days: 0, materialCount: 1 });
  });

  it("marks archived customers instead of hiding their open entries", async () => {
    const archived = (
      await db.prisma.customer.create({ data: { ...createValidTestCustomer(), company: "Archiv AG", archivedAt: new Date() } })
    ).customerId;
    await add(archived, { quantity: 1 });

    const rows = await listOpenWork(db.prisma);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: archived, archived: true, entryCount: 1 });
  });

  it("returns nothing when no entry is open", async () => {
    expect(await listOpenWork(db.prisma)).toEqual([]);
  });
});
