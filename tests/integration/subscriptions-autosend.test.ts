import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

const sendPendingInvoice = vi.fn();
vi.mock("@/lib/pending-email-send", () => ({ sendPendingInvoice: (...a: unknown[]) => sendPendingInvoice(...a) }));
const notifyAdmins = vi.fn();
vi.mock("@/lib/notifications", () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }));

import { checkSubscriptions, SYSTEM_ACTOR } from "@/lib/subscriptions";

describe("checkSubscriptions with autoSend", () => {
  const db = createTestDatabase();
  const yesterday = new Date(Date.now() - 86_400_000);

  beforeEach(async () => {
    sendPendingInvoice.mockReset();
    notifyAdmins.mockReset();
    // notifyAdmins is only called when settings exist
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  async function seed(opts: { autoSend: boolean; template: "items" | "empty" | "none" }) {
    const template =
      opts.template === "none"
        ? null
        : await db.prisma.invoiceTemplate.create({
            data: {
              name: "T",
              items:
                opts.template === "items"
                  ? { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] }
                  : undefined,
            },
          });
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: template?.id ?? null,
        interval: "Yearly",
        nextInvoiceDate: yesterday,
        autoSend: opts.autoSend,
      },
    });
  }

  it("sends the pending invoice as the system actor", async () => {
    sendPendingInvoice.mockResolvedValue({ invoiceId: 1 });
    await seed({ autoSend: true, template: "items" });
    await checkSubscriptions(db.prisma);

    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    expect(sendPendingInvoice).toHaveBeenCalledTimes(1);
    expect(sendPendingInvoice).toHaveBeenCalledWith({
      pendingId: pending.id,
      to: pending.to,
      subject: pending.subject,
      body: pending.body,
      actor: SYSTEM_ACTOR,
    });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("keeps draft and pending email and notifies the admins when sending fails", async () => {
    sendPendingInvoice.mockResolvedValue({ error: "SMTP down" });
    const sub = await seed({ autoSend: true, template: "items" });
    await checkSubscriptions(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    const updated = await db.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.nextInvoiceDate.getTime()).toBeGreaterThan(Date.now());
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins.mock.calls[0][2]).toContain("SMTP down");
    expect(notifyAdmins.mock.calls[0][3]).toBe("/invoices/pending");
  });

  it("does not throw, keeps the pending email and notifies when sending throws", async () => {
    sendPendingInvoice.mockRejectedValue(new Error("boom"));
    await seed({ autoSend: true, template: "items" });
    await expect(checkSubscriptions(db.prisma)).resolves.toBeUndefined();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it("never auto-sends without a template", async () => {
    await seed({ autoSend: true, template: "none" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("never auto-sends a template without items (CHF 0 invoice)", async () => {
    await seed({ autoSend: true, template: "empty" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("does not auto-send when autoSend is off", async () => {
    await seed({ autoSend: false, template: "items" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
  });
});
