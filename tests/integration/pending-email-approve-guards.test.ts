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
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { checkSubscriptions } from "@/lib/subscriptions";
import { approvePendingEmail } from "@/app/(app)/invoices/pending/actions";

const editor = {
  user: { id: "1", name: "Test", email: "test@example.com", role: "Editor" },
  expires: "2099-01-01",
} as Session;

function approveForm(id: number, to: string) {
  const form = new FormData();
  form.set("id", String(id));
  form.set("to", to);
  form.set("subject", "Rechnung {documentNumber}");
  form.set("body", "Guten Tag");
  return form;
}

describe("approvePendingEmail refuses sends that must not go out (integration)", () => {
  const db = createTestDatabase();

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = editor;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
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
      },
    });
    await checkSubscriptions(db.prisma);
  });

  it("does not send an invoice without items and does not use up a number", async () => {
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    await db.prisma.item.deleteMany({ where: { invoiceId: pending.invoiceId } });

    const result = await approvePendingEmail({}, approveForm(pending.id, "kunde@example.com"));

    expect(result.error).toMatch(/keine Positionen/);
    expect(result.success).toBeUndefined();
    const invoice = await db.prisma.invoice.findUniqueOrThrow({ where: { id: pending.invoiceId } });
    expect(invoice.documentNumber).toBeNull();
    expect(invoice.state).toBe("Draft");
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(await db.prisma.invoiceSentLog.count()).toBe(0);
  });

  it("does not send to an invalid address and does not use up a number", async () => {
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();

    const result = await approvePendingEmail({}, approveForm(pending.id, "a@b"));

    expect(result.error).toMatch(/gültige E-Mail-Adresse/);
    const invoice = await db.prisma.invoice.findUniqueOrThrow({ where: { id: pending.invoiceId } });
    expect(invoice.documentNumber).toBeNull();
    expect(invoice.state).toBe("Draft");
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });
});
