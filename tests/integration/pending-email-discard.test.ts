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
import { discardPendingEmail } from "@/app/(app)/invoices/pending/actions";
import { acquireSendLock, invoiceSendLockKey, SEND_IN_PROGRESS_ERROR } from "@/lib/send-lock";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

describe("discardPendingEmail (integration)", () => {
  const db = createTestDatabase();
  let subscriptionId: number;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    holder.session = sessionFor("Editor");
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "T", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] } },
    });
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const sub = await db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: template.id,
        interval: "Yearly",
        nextInvoiceDate: new Date(Date.now() - 86_400_000),
      },
    });
    subscriptionId = sub.id;
    await checkSubscriptions(db.prisma);
  });

  it("deletes the draft, its items and the pending email; the period stays skipped", async () => {
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    const nextDateBefore = (await db.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }))
      .nextInvoiceDate;

    const result = await discardPendingEmail(pending.id);

    expect(result).toEqual({ success: true, invoiceDeleted: true });
    expect(await db.prisma.pendingEmail.count()).toBe(0);
    expect(await db.prisma.invoice.count()).toBe(0);
    expect(await db.prisma.item.count({ where: { invoiceId: null, quoteId: null } })).toBe(0);
    const sub = await db.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(sub.nextInvoiceDate).toEqual(nextDateBefore);

    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "DELETE" } });
    expect(audit.entityType).toBe("Invoice");
    expect(audit.entityId).toBe(pending.invoiceId);
    expect(JSON.parse(audit.details!)).toMatchObject({ reason: "Abo-Entwurf verworfen", subscriptionId });
  });

  it("keeps an invoice that was sent meanwhile and removes only the pending email", async () => {
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    await db.prisma.invoice.update({
      where: { id: pending.invoiceId },
      data: { state: "Sent", documentNumber: "I-26100001" },
    });

    const result = await discardPendingEmail(pending.id);

    expect(result.success).toBe(true);
    expect(result.invoiceDeleted).toBe(false);
    expect(result.message).toBeTruthy();
    expect(await db.prisma.pendingEmail.count()).toBe(0);
    expect(await db.prisma.invoice.count()).toBe(1);
    const audit = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "DELETE" } });
    expect(audit.entityType).toBe("PendingEmail");
    expect(audit.entityRef).toBe("I-26100001");
  });

  it("answers 'nicht gefunden' for an unknown entry", async () => {
    expect(await discardPendingEmail(99999)).toEqual({ error: "Eintrag nicht gefunden." });
    expect(await db.prisma.invoice.count()).toBe(1);
  });

  it("refuses while the send lock of the invoice is held and deletes nothing", async () => {
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    const release = acquireSendLock(invoiceSendLockKey(pending.invoiceId));
    expect(release).not.toBeNull();
    try {
      expect(await discardPendingEmail(pending.id)).toEqual({ error: SEND_IN_PROGRESS_ERROR });
    } finally {
      release?.();
    }

    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.item.count({ where: { invoiceId: pending.invoiceId } })).toBe(1);
    expect(await db.prisma.auditLog.count({ where: { action: "DELETE" } })).toBe(0);
    // The lock is free again afterwards
    expect(await discardPendingEmail(pending.id)).toEqual({ success: true, invoiceDeleted: true });
  });

  it("refuses viewers and changes nothing", async () => {
    holder.session = sessionFor("Viewer");
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    await expect(discardPendingEmail(pending.id)).rejects.toThrow();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(await db.prisma.invoice.count()).toBe(1);
  });
});
