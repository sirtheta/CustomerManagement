import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// sendPendingInvoice uses the default prisma singleton; route it to the per-suite test DB.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));
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
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn(), generateQuotePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn() }));

import { sendPendingInvoice } from "@/lib/pending-email-send";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;

describe("sendPendingInvoice when recording the send fails", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.restoreAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("%PDF-1.4 bytes"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "pending-send-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedPending() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
        items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 100, quantity: 1, totalAmount: 100 }] },
      },
    });
    return db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
    });
  }

  const input = (pendingId: number) => ({ pendingId, to: "a@b.ch", subject: "s", body: "b", actor });

  /**
   * Makes the first `failures` calls of the array-form `$transaction` (the one that
   * records the send) reject. The interactive form used by `assignDocumentNumber`
   * is passed through untouched.
   */
  function failRecording(failures: number) {
    const original = db.prisma.$transaction.bind(db.prisma) as (...a: unknown[]) => unknown;
    let recordingCalls = 0;
    vi.spyOn(db.prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
      if (Array.isArray(args[0])) {
        recordingCalls += 1;
        if (recordingCalls <= failures) return Promise.reject(new Error("SQLITE_BUSY"));
      }
      return original(...args);
    }) as never);
    return () => recordingCalls;
  }

  it("retries the recording once and succeeds on a transient failure", async () => {
    const pending = await seedPending();
    const recordingCalls = failRecording(1);

    const result = await sendPendingInvoice(input(pending.id));

    expect(result).toMatchObject({ invoiceId: pending.invoiceId, documentNumber: expect.stringMatching(/^I-/) });
    expect(recordingCalls()).toBe(2);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(await db.prisma.pendingEmail.count()).toBe(0);
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: pending.invoiceId } })).state).toBe("Sent");
  });

  it("returns mailSent with a do-not-resend warning when the recording keeps failing, instead of throwing", async () => {
    const pending = await seedPending();
    const recordingCalls = failRecording(Infinity);

    const result = await sendPendingInvoice(input(pending.id));

    expect(recordingCalls()).toBe(2);
    expect(result).toMatchObject({ mailSent: true });
    expect((result as { error: string }).error).toContain("bereits versendet");
    expect((result as { error: string }).error).toContain("nicht erneut");
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it("does not mark ordinary failures (mail not sent) as mailSent", async () => {
    const pending = await seedPending();
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error("SMTP down"));

    const result = await sendPendingInvoice(input(pending.id));

    expect(result).toEqual({ error: "SMTP down" });
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });
});
