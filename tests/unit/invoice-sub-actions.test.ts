import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    pendingReminder: { findUnique: vi.fn(), update: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
    invoiceSentLog: { create: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    pendingEmail: { findUnique: vi.fn(), delete: vi.fn() },
    invoiceTemplate: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    templateItem: { deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/components/items-editor-schema", () => ({
  itemDataSchema: {
    array: () => ({
      parse: (v: unknown) => v,
    }),
  },
}));

import { sendReminder, dismissReminder } from "@/app/(app)/invoices/reminders/actions";
import { saveAsTemplate, createTemplate, updateTemplate, deleteTemplate } from "@/app/(app)/invoices/templates/actions";
import { approvePendingEmail, discardPendingEmail } from "@/app/(app)/invoices/pending/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";

const editorSession = {
  user: { id: "1", name: "Editor", email: "editor@test.ch", role: "Editor" },
} as never;
const adminSession = {
  user: { id: "2", name: "Admin", email: "admin@test.ch", role: "Admin" },
} as never;
const viewerSession = {
  user: { id: "3", name: "Viewer", email: "viewer@test.ch", role: "Viewer" },
} as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const mockInvoice = {
  id: 10,
  documentNumber: "R-2026-010",
  customer: { email: "kunde@test.ch" },
  items: [{ id: 1 }],
};

const mockSettings = {
  reminderCooldownDays: 14,
  companyInfo: {},
};

describe("invoices/reminders actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendReminder", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      await expect(
        sendReminder({}, form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" }))
      ).rejects.toThrow();
    });

    it("returns error when reminder not found", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue(null);
      const result = await sendReminder(
        {},
        form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("Mahnung nicht gefunden.");
    });

    it("returns error when settings not configured", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await sendReminder(
        {},
        form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("Einstellungen nicht konfiguriert.");
    });

    it("returns error when PDF generation fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockRejectedValue(new Error("PDF error"));
      const result = await sendReminder(
        {},
        form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("PDF error");
    });

    it("sends reminder, updates reminder level, logs audit, and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const reminder = {
        id: 1,
        invoiceId: 10,
        reminderLevel: 1,
        invoice: { ...mockInvoice, documentNumber: "R-2026-010" },
      };
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue(reminder as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.invoiceSentLog.create).mockResolvedValue({} as never);
      vi.mocked(prisma.pendingReminder.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((arg: ((tx: typeof prisma) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) as never : arg(prisma) as never
      );

      const result = await sendReminder(
        {},
        form({ reminderId: "1", to: "kunde@test.ch", subject: "Mahnung", body: "Text" })
      );
      expect(result.success).toBe(true);
      expect(generateInvoicePdf).toHaveBeenCalled();
      expect(sendInvoiceEmail).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(
        editorSession,
        "SEND",
        "Reminder",
        10,
        "R-2026-010",
        expect.any(Object)
      );
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/reminders");
    });
  });

  describe("dismissReminder", () => {
    it("dismisses reminder with snooze and logs audit", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        reminderCooldownDays: 7,
      } as never);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 2,
        invoiceId: 10,
        invoice: { id: 10, documentNumber: "R-2026-010" },
      } as never);
      vi.mocked(prisma.pendingReminder.update).mockResolvedValue({} as never);

      await dismissReminder(2);
      expect(prisma.pendingReminder.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: expect.objectContaining({ snoozedUntil: expect.any(Date) }),
      });
      expect(logAudit).toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/reminders");
    });
  });
});

describe("invoices/templates actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveAsTemplate", () => {
    it("returns error for empty name", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await saveAsTemplate(1, "   ");
      expect(result.error).toContain("Namen");
    });

    it("returns error when invoice not found", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
      const result = await saveAsTemplate(1, "Vorlage 1");
      expect(result.error).toBe("Rechnung nicht gefunden.");
    });

    it("returns error when invoice has no items", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ items: [] } as never);
      const result = await saveAsTemplate(1, "Vorlage 1");
      expect(result.error).toBe("Die Rechnung hat keine Positionen.");
    });

    it("creates template from invoice and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        items: [{ name: "Item", description: null, unit: "Stunde", unitPrice: 100, quantity: 1, categoryId: null }],
      } as never);
      vi.mocked(prisma.invoiceTemplate.create).mockResolvedValue({} as never);

      const result = await saveAsTemplate(1, "Monatsrechnung");
      expect(result.success).toBe(true);
      expect(prisma.invoiceTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: "Monatsrechnung" }),
      });
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/templates");
    });
  });

  describe("createTemplate", () => {
    it("returns error for missing name", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await createTemplate({}, form({}));
      expect(result.error).toBe("Bitte einen Namen angeben.");
    });

    it("creates template and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.invoiceTemplate.create).mockResolvedValue({} as never);
      const result = await createTemplate({}, form({ name: "Neue Vorlage" }));
      expect(result.success).toBe(true);
      expect(prisma.invoiceTemplate.create).toHaveBeenCalledWith({ data: { name: "Neue Vorlage" } });
    });
  });

  describe("updateTemplate", () => {
    it("returns error for missing name", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await updateTemplate(1, {}, form({ itemsJson: "[]" }));
      expect(result.error).toBe("Bitte einen Namen angeben.");
    });

    it("updates template with items and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.templateItem.deleteMany).mockResolvedValue({ count: 0 } as never);
      vi.mocked(prisma.invoiceTemplate.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((arg: ((tx: typeof prisma) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) as never : arg(prisma) as never
      );

      const result = await updateTemplate(2, {}, form({ name: "Aktualisiert", itemsJson: "[]" }));
      expect(result.success).toBe(true);
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/templates");
    });
  });

  describe("deleteTemplate", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      await expect(deleteTemplate(1)).rejects.toThrow();
    });

    it("deletes template and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.invoiceTemplate.delete).mockResolvedValue({} as never);
      const result = await deleteTemplate(3);
      expect(result.success).toBe(true);
      expect(prisma.invoiceTemplate.delete).toHaveBeenCalledWith({ where: { id: 3 } });
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/templates");
    });
  });
});

describe("invoices/pending actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("approvePendingEmail", () => {
    it("returns error when pending entry not found", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue(null);
      const result = await approvePendingEmail(
        {},
        form({ id: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("Eintrag nicht gefunden.");
    });

    it("returns error when settings not configured", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({
        id: 1,
        invoiceId: 10,
        invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await approvePendingEmail(
        {},
        form({ id: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("Einstellungen nicht konfiguriert.");
    });

    it("returns error when email sending fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({
        id: 1,
        invoiceId: 10,
        invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockRejectedValue(new Error("PDF failed"));
      const result = await approvePendingEmail(
        {},
        form({ id: "1", to: "x@x.ch", subject: "s", body: "b" })
      );
      expect(result.error).toBe("PDF failed");
    });

    it("sends email, updates invoice state to Sent, and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({
        id: 1,
        invoiceId: 10,
        invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
      vi.mocked(prisma.pendingEmail.delete).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((arg: ((tx: typeof prisma) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) as never : arg(prisma) as never
      );

      const result = await approvePendingEmail(
        {},
        form({ id: "1", to: "kunde@test.ch", subject: "Rechnung", body: "Bitte bezahlen" })
      );
      expect(result.success).toBe(true);
      expect(sendInvoiceEmail).toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { state: "Sent" },
      });
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/pending");
    });
  });

  describe("discardPendingEmail", () => {
    it("deletes pending email and revalidates", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.delete).mockResolvedValue({} as never);
      await discardPendingEmail(5);
      expect(prisma.pendingEmail.delete).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(revalidatePath).toHaveBeenCalledWith("/invoices/pending");
    });
  });
});
