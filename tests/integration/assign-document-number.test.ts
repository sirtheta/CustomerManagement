import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { assignDocumentNumber, isDocumentNumberCollision } from "@/lib/document-number";
import { swissDateString } from "@/lib/date";

vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;

/** Year/month part of a number assigned "now" (computed per call, never at module load). */
function period(): string {
  const [year, month] = swissDateString().split("-");
  return `${year.slice(-2)}${month}`;
}

describe("assignDocumentNumber", () => {
  const db = createTestDatabase();
  let yy_mm: string;

  // Only Date is faked: the clock stays put between computing the expected
  // number and assigning it, so a test running across a month change cannot flake.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
    yy_mm = period();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function draftInvoice(documentNumber: string | null = null) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
  }

  it("assigns the next number of the current month to an invoice draft", async () => {
    await db.prisma.applicationSettings.deleteMany();
    const invoice = await draftInvoice();

    const number = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });

    expect(number).toBe(`I-${yy_mm}0001`);
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBe(number);
  });

  it("is idempotent: a second call returns the same number", async () => {
    const invoice = await draftInvoice();
    const first = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    const second = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    expect(second).toBe(first);
  });

  it("keeps an existing (legacy) number", async () => {
    const invoice = await draftInvoice("R-25010007");
    expect(await assignDocumentNumber("invoice", invoice.id, { client: db.prisma })).toBe("R-25010007");
  });

  it("does not leave a gap when an unnumbered draft is deleted", async () => {
    const deleted = await draftInvoice();
    const kept = await draftInvoice();
    await db.prisma.invoice.delete({ where: { id: deleted.id } });

    expect(await assignDocumentNumber("invoice", kept.id, { client: db.prisma })).toBe(`I-${yy_mm}0001`);
  });

  it("numbers sequentially across concurrent calls", async () => {
    const a = await draftInvoice();
    const b = await draftInvoice();
    const numbers = await Promise.all([
      assignDocumentNumber("invoice", a.id, { client: db.prisma }),
      assignDocumentNumber("invoice", b.id, { client: db.prisma }),
    ]);
    expect(new Set(numbers).size).toBe(2);
  });

  it("assigns quote numbers with the quote prefix", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const quote = await db.prisma.quote.create({
      data: {
        customerId: customer.customerId,
        date: new Date(),
        validUntil: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
    expect(await assignDocumentNumber("quote", quote.id, { client: db.prisma })).toBe(`Q-${yy_mm}0001`);
  });

  it("writes an UPDATE audit entry only when a number is newly assigned", async () => {
    const invoice = await draftInvoice();
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });

    const entries = await db.prisma.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "UPDATE", entityType: "Invoice", entityId: invoice.id });
  });

  function collisionError() {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      // Shape produced by the better-sqlite3 driver adapter
      meta: {
        driverAdapterError: {
          cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["documentNumber"] } },
        },
      },
    });
  }

  // Wraps the client so `$transaction` fails with a number collision for the
  // first `failures` calls, then passes through to the real database.
  function collidingClient(failures: number) {
    let calls = 0;
    const client = new Proxy(db.prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return (...args: unknown[]) => {
            calls += 1;
            if (calls <= failures) return Promise.reject(collisionError());
            return (target.$transaction as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;
    return { client, calls: () => calls };
  }

  it("retries once on a documentNumber collision and succeeds", async () => {
    const invoice = await draftInvoice();
    const { client, calls } = collidingClient(1);

    const number = await assignDocumentNumber("invoice", invoice.id, { client });

    expect(calls()).toBe(2);
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBe(number);
  });

  it("gives up after a second collision", async () => {
    const invoice = await draftInvoice();
    const { client, calls } = collidingClient(2);

    await expect(assignDocumentNumber("invoice", invoice.id, { client, actor })).rejects.toSatisfy(
      (err: unknown) => isDocumentNumberCollision(err)
    );

    expect(calls()).toBe(2);
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBeNull();
    expect(await db.prisma.auditLog.count()).toBe(0);
  });

  it("does not retry on a non-collision error", async () => {
    const invoice = await draftInvoice();
    let calls = 0;
    const client = new Proxy(db.prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return () => {
            calls += 1;
            return Promise.reject(new Error("DB down"));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;

    await expect(assignDocumentNumber("invoice", invoice.id, { client })).rejects.toThrow("DB down");
    expect(calls).toBe(1);
  });

  it("returns the winner's number when a concurrent call numbers the draft first", async () => {
    const invoice = await draftInvoice();
    // Simulates the race: between our read and our conditional update,
    // another caller writes a number, so our updateMany matches no row.
    const client = new Proxy(db.prisma, {
      get(target, prop, receiver) {
        if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
        return (cb: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => {
            const racingTx = new Proxy(tx, {
              get(t, p, r) {
                if (p !== "invoice") return Reflect.get(t, p, r);
                return new Proxy(t.invoice, {
                  get(m, name, mr) {
                    if (name !== "updateMany") return Reflect.get(m, name, mr);
                    return async (args: Prisma.InvoiceUpdateManyArgs) => {
                      await t.invoice.update({ where: { id: invoice.id }, data: { documentNumber: "R-99990001" } });
                      return t.invoice.updateMany(args);
                    };
                  },
                });
              },
            });
            return cb(racingTx as Prisma.TransactionClient);
          });
      },
    }) as PrismaClient;

    const number = await assignDocumentNumber("invoice", invoice.id, { client, actor });

    expect(number).toBe("R-99990001");
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBe("R-99990001");
    expect(await db.prisma.auditLog.count()).toBe(0);
  });

  // The period follows the Swiss day whatever the server zone is (a container is UTC without TZ).
  describe.each(["Europe/Zurich", "UTC"])("at the turn of the year (server TZ=%s)", (serverTz) => {
    const originalTz = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = serverTz;
    });
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it.each([
      // 31.12.2026 23:59 CET = 22:59 UTC
      ["31.12. 23:59", "2026-12-31T22:59:00.000Z", "2612"],
      // 01.01.2027 00:00 CET = 31.12.2026 23:00 UTC
      ["1.1. 00:00", "2026-12-31T23:00:00.000Z", "2701"],
    ])("numbers an invoice and a quote at %s with the Swiss year/month", async (_label, instant, expected) => {
      vi.setSystemTime(new Date(instant));
      expect(period()).toBe(expected);

      const invoice = await draftInvoice();
      expect(await assignDocumentNumber("invoice", invoice.id, { client: db.prisma })).toBe(`I-${expected}0001`);

      const quote = await db.prisma.quote.create({
        data: {
          customerId: invoice.customerId,
          date: new Date(),
          validUntil: new Date(),
          totalAmount: 100,
          state: "Draft",
        },
      });
      expect(await assignDocumentNumber("quote", quote.id, { client: db.prisma })).toBe(`Q-${expected}0001`);
    });

    it("starts again at 0001 in the new year after numbers of December exist", async () => {
      vi.setSystemTime(new Date("2026-12-31T22:59:00.000Z"));
      const december = await draftInvoice();
      expect(await assignDocumentNumber("invoice", december.id, { client: db.prisma })).toBe("I-26120001");

      vi.setSystemTime(new Date("2026-12-31T23:00:00.000Z"));
      const january = await draftInvoice();
      expect(await assignDocumentNumber("invoice", january.id, { client: db.prisma })).toBe("I-27010001");
    });
  });

  it("throws for an unknown id", async () => {
    await expect(assignDocumentNumber("invoice", 999_999, { client: db.prisma })).rejects.toThrow(
      "Dokument nicht gefunden."
    );
  });
});
