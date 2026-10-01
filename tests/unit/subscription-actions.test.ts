import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    subscription: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    invoiceTemplate: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import {
  createSubscription,
  updateSubscription,
  setSubscriptionActive,
  deleteSubscription,
} from "@/app/(app)/customers/subscription-actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

const editorSession = {
  user: { id: "1", name: "Editor", email: "editor@test.ch", role: "Editor" },
} as never;
const viewerSession = {
  user: { id: "3", name: "Viewer", email: "viewer@test.ch", role: "Viewer" },
} as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  interval: "Quarterly",
  nextInvoiceDate: "2027-01-01",
  templateId: "5",
  autoSend: "on",
};

describe("subscription actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({ id: 5, _count: { items: 2 } } as never);
  });

  describe("createSubscription", () => {
    it("creates, audits and returns success", async () => {
      vi.mocked(prisma.subscription.create).mockResolvedValue({ id: 11 } as never);
      const res = await createSubscription(1, {}, form(VALID));
      expect(res.success).toBe(true);
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: {
          customerId: 1,
          interval: "Quarterly",
          nextInvoiceDate: new Date(2027, 0, 1),
          templateId: 5,
          autoSend: true,
          active: true,
        },
      });
      expect(logAudit).toHaveBeenCalledWith(
        editorSession,
        "CREATE",
        "Subscription",
        11,
        expect.any(String),
        expect.objectContaining({ customerId: 1, templateId: 5, autoSend: true })
      );
    });

    it("rejects an invalid interval", async () => {
      const res = await createSubscription(1, {}, form({ ...VALID, interval: "Weekly" }));
      expect(res).toEqual({ error: "Ungültiges Intervall." });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it("rejects a missing or invalid date", async () => {
      const missing = await createSubscription(1, {}, form({ ...VALID, nextInvoiceDate: "" }));
      expect(missing).toEqual({ error: "Bitte ein gültiges Datum angeben." });
      const invalid = await createSubscription(1, {}, form({ ...VALID, nextInvoiceDate: "2027-02-30" }));
      expect(invalid).toEqual({ error: "Bitte ein gültiges Datum angeben." });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it("rejects autoSend without template", async () => {
      const res = await createSubscription(1, {}, form({ ...VALID, templateId: "" }));
      expect(res).toEqual({ error: "Automatischer Versand braucht eine Vorlage." });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown template", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue(null);
      const res = await createSubscription(1, {}, form(VALID));
      expect(res).toEqual({ error: "Vorlage nicht gefunden." });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it("rejects autoSend for a template without items", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({ id: 5, _count: { items: 0 } } as never);
      const res = await createSubscription(1, {}, form(VALID));
      expect(res).toEqual({
        error: "Die Vorlage hat keine Positionen. Automatischer Versand ist nur mit einer befüllten Vorlage möglich.",
      });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it("allows an empty template without autoSend", async () => {
      vi.mocked(prisma.invoiceTemplate.findUnique).mockResolvedValue({ id: 5, _count: { items: 0 } } as never);
      vi.mocked(prisma.subscription.create).mockResolvedValue({ id: 12 } as never);
      const { autoSend: _a, ...noAuto } = VALID;
      void _a;
      const res = await createSubscription(1, {}, form(noAuto));
      expect(res.success).toBe(true);
    });

    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(createSubscription(1, {}, form(VALID))).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe("updateSubscription", () => {
    it("validates and updates scoped to the customer", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 } as never);
      const res = await updateSubscription(1, 7, {}, form(VALID));
      expect(res.success).toBe(true);
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 7, customerId: 1 },
        data: {
          interval: "Quarterly",
          nextInvoiceDate: new Date(2027, 0, 1),
          templateId: 5,
          autoSend: true,
        },
      });
      expect(logAudit).toHaveBeenCalledWith(
        editorSession,
        "UPDATE",
        "Subscription",
        7,
        expect.any(String),
        expect.objectContaining({ customerId: 1 })
      );
    });

    it("does not write nextInvoiceDate when it equals the loaded date", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 } as never);
      const res = await updateSubscription(1, 7, {}, form({ ...VALID, loadedNextInvoiceDate: "2027-01-01" }));
      expect(res.success).toBe(true);
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 7, customerId: 1 },
        data: { interval: "Quarterly", templateId: 5, autoSend: true },
      });
    });

    it("writes nextInvoiceDate when it differs from the loaded date", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 } as never);
      await updateSubscription(1, 7, {}, form({ ...VALID, loadedNextInvoiceDate: "2026-10-01" }));
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 7, customerId: 1 },
        data: expect.objectContaining({ nextInvoiceDate: new Date(2027, 0, 1) }),
      });
    });

    it("still validates the date when it equals the loaded date", async () => {
      const res = await updateSubscription(
        1, 7, {}, form({ ...VALID, nextInvoiceDate: "2027-02-30", loadedNextInvoiceDate: "2027-02-30" })
      );
      expect(res).toEqual({ error: "Bitte ein gültiges Datum angeben." });
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const res = await updateSubscription(1, 7, {}, form({ ...VALID, interval: "Weekly" }));
      expect(res).toEqual({ error: "Ungültiges Intervall." });
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it("returns an error when nothing matched", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 0 } as never);
      const res = await updateSubscription(1, 7, {}, form(VALID));
      expect(res).toEqual({ error: "Abo nicht gefunden." });
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe("setSubscriptionActive", () => {
    it("updates scoped to the customer and audits", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 } as never);
      await setSubscriptionActive(1, 7, false);
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 7, customerId: 1 },
        data: { active: false },
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Subscription", 7, undefined, {
        customerId: 1,
        active: false,
      });
    });

    it("does not audit when the customer does not match", async () => {
      vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 0 } as never);
      await setSubscriptionActive(2, 7, false);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe("deleteSubscription", () => {
    it("deletes scoped to the customer and audits (Editor allowed)", async () => {
      vi.mocked(prisma.subscription.deleteMany).mockResolvedValue({ count: 1 } as never);
      await deleteSubscription(1, 7);
      expect(prisma.subscription.deleteMany).toHaveBeenCalledWith({ where: { id: 7, customerId: 1 } });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "DELETE", "Subscription", 7, undefined, {
        customerId: 1,
      });
    });

    it("does not audit when nothing was deleted", async () => {
      vi.mocked(prisma.subscription.deleteMany).mockResolvedValue({ count: 0 } as never);
      await deleteSubscription(2, 7);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});
