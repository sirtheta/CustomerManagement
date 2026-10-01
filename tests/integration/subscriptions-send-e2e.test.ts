import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn(), generateQuotePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn() }));

import { checkSubscriptions } from "@/lib/subscriptions";
import { verifyArchived, sha256Hex } from "@/lib/document-archive";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";

describe("autoSend end to end", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("%PDF-1.4 subscription bytes"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "subscription-send-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("numbers, archives, mails and marks the invoice as Sent", async () => {
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "T", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] } },
    });
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    await db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: template.id,
        interval: "Yearly",
        nextInvoiceDate: new Date(Date.now() - 86_400_000),
        autoSend: true,
      },
    });

    await checkSubscriptions(db.prisma);

    const invoice = await db.prisma.invoice.findFirstOrThrow();
    expect(invoice.state).toBe("Sent");
    expect(invoice.documentNumber).not.toBeNull();
    expect(await db.prisma.pendingEmail.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(1);

    const rows = await db.prisma.sentDocument.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].createdById).toBe(0);
    const attached = vi.mocked(sendInvoiceEmail).mock.calls[0][2];
    expect(rows[0].sha256).toBe(sha256Hex(attached));
    expect(readFileSync(join(dir, rows[0].path))).toEqual(attached);
    expect((await verifyArchived(rows[0])).ok).toBe(true);
  });
});
