import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    quote: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    item: { createMany: vi.fn(), deleteMany: vi.fn() },
    quoteSentLog: { create: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
    invoice: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/document-number", () => ({
  generateQuoteNumber: vi.fn(),
  generateInvoiceNumber: vi.fn(),
}));
vi.mock("@/lib/form-parsers", () => ({ parseDocumentItems: vi.fn() }));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateQuotePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendQuoteEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  sendQuote,
  convertQuoteToInvoice,
} from "@/app/(app)/quotes/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { generateQuoteNumber, generateInvoiceNumber } from "@/lib/document-number";
import { parseDocumentItems } from "@/lib/form-parsers";
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendQuoteEmail } from "@/lib/email";

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

const BASE_FORM = { customerId: "1", date: "2026-01-15", validUntil: "2026-02-15" };

describe("quote actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createQuote", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(createQuote({}, form({}))).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns error for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await createQuote({}, form({ date: "2026-01-15" }));
      expect(result.error).toBe("Bitte alle Pflichtfelder ausfüllen.");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns error for invalid items JSON", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockImplementation(() => {
        throw new Error("bad json");
      });
      const result = await createQuote({}, form(BASE_FORM));
      expect(result.error).toBe("Ungültige Positionsdaten.");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns error when transaction fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockReturnValue({ items: [], totalAmount: 0 });
      vi.mocked(generateQuoteNumber).mockResolvedValue("Q-2026-001");
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("DB error"));
      const result = await createQuote({}, form(BASE_FORM));
      expect(result.error).toBe("Offerte konnte nicht erstellt werden.");
    });

    it("creates quote, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockReturnValue({ items: [], totalAmount: 350 });
      vi.mocked(generateQuoteNumber).mockResolvedValue("Q-2026-001");
      vi.mocked(prisma.quote.create).mockResolvedValue({
        id: 5,
        documentNumber: "Q-2026-001",
      } as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/quotes/5");
      });

      await expect(createQuote({}, form(BASE_FORM))).rejects.toThrow("REDIRECT:/quotes/5");
      expect(prisma.quote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 1,
          documentNumber: "Q-2026-001",
          totalAmount: 350,
          state: "Draft",
        }),
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "CREATE", "Quote", 5, "Q-2026-001");
    });

    it("creates quote items when items are provided", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const items = [
        {
          name: "Beratung",
          description: null,
          unit: "Stunde",
          unitPrice: 150,
          quantity: 2,
          totalAmount: 300,
          customText: null,
          categoryId: null,
        },
      ];
      vi.mocked(parseDocumentItems).mockReturnValue({ items: items as never, totalAmount: 300 });
      vi.mocked(generateQuoteNumber).mockResolvedValue("Q-2026-002");
      vi.mocked(prisma.quote.create).mockResolvedValue({
        id: 6,
        documentNumber: "Q-2026-002",
      } as never);
      vi.mocked(prisma.item.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/quotes/6");
      });

      await expect(createQuote({}, form(BASE_FORM))).rejects.toThrow("REDIRECT:/quotes/6");
      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: "Beratung", quoteId: 6 }),
        ]),
      });
    });
  });

  describe("updateQuote", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(updateQuote(1, {}, form({}))).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns error for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await updateQuote(1, {}, form({}));
      expect(result.error).toBe("Bitte alle Pflichtfelder ausfüllen.");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns error for invalid items JSON", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockImplementation(() => {
        throw new Error("bad json");
      });
      const result = await updateQuote(1, {}, form(BASE_FORM));
      expect(result.error).toBe("Ungültige Positionsdaten.");
    });

    it("updates quote, deletes old items, creates new items, logs audit, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockReturnValue({ items: [], totalAmount: 200 });
      vi.mocked(prisma.item.deleteMany).mockResolvedValue({ count: 2 } as never);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/quotes/1");
      });

      await expect(updateQuote(1, {}, form(BASE_FORM))).rejects.toThrow("REDIRECT:/quotes/1");
      expect(prisma.item.deleteMany).toHaveBeenCalledWith({ where: { quoteId: 1 } });
      expect(prisma.quote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ customerId: 1, totalAmount: 200 }),
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Quote", 1);
    });

    it("includes ?from= in redirect when from starts with 'customers/'", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockReturnValue({ items: [], totalAmount: 0 });
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        updateQuote(2, {}, form({ ...BASE_FORM, from: "customers/42" }))
      ).rejects.toThrow("REDIRECT");
      expect(redirect).toHaveBeenCalledWith("/quotes/2?from=customers/42");
    });

    it("omits ?from= when from does not start with 'customers/'", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(parseDocumentItems).mockReturnValue({ items: [], totalAmount: 0 });
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        updateQuote(2, {}, form({ ...BASE_FORM, from: "invoices/42" }))
      ).rejects.toThrow("REDIRECT");
      expect(redirect).toHaveBeenCalledWith("/quotes/2");
    });
  });

  describe("updateQuoteStatus", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(updateQuoteStatus(1, "Sent")).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.quote.update).not.toHaveBeenCalled();
    });

    it("updates quote state", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      await updateQuoteStatus(3, "Sent");
      expect(prisma.quote.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { state: "Sent" },
      });
    });
  });

  describe("deleteQuote", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(deleteQuote(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.quote.delete).not.toHaveBeenCalled();
    });

    it("deletes quote, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        documentNumber: "Q-2026-001",
      } as never);
      vi.mocked(prisma.quote.delete).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/quotes");
      });

      await expect(deleteQuote(1)).rejects.toThrow("REDIRECT:/quotes");
      expect(prisma.quote.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Quote", 1, "Q-2026-001");
    });

    it("returns an error instead of throwing when delete fails", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        documentNumber: "Q-2026-001",
      } as never);
      vi.mocked(prisma.quote.delete).mockRejectedValue(new Error("FOREIGN KEY constraint failed"));

      const result = await deleteQuote(1);
      expect(result.error).toBeTruthy();
      expect(redirect).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe("sendQuote", () => {
    it("returns error for invalid quoteId", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await sendQuote({}, form({ quoteId: "not-a-number", to: "test@test.ch" }));
      expect(result.error).toBe("Ungültige Offerten-ID.");
    });

    it("returns error when to is missing", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await sendQuote({}, form({ quoteId: "1" }));
      expect(result.error).toBe("Bitte eine Empfänger-E-Mail-Adresse angeben.");
    });

    it("returns error when quote not found", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({} as never);
      const result = await sendQuote({}, form({ quoteId: "1", to: "test@test.ch" }));
      expect(result.error).toBe("Offerte nicht gefunden.");
    });

    it("returns error when settings not configured", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 1,
        customer: {},
        items: [],
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);
      const result = await sendQuote({}, form({ quoteId: "1", to: "test@test.ch" }));
      expect(result.error).toBe("Einstellungen nicht konfiguriert.");
    });

    it("returns error when PDF generation fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 1,
        documentNumber: "Q-001",
        customer: {},
        items: [],
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        companyInfo: {},
      } as never);
      vi.mocked(generateQuotePdf).mockRejectedValue(new Error("PDF generation failed"));
      const result = await sendQuote({}, form({ quoteId: "1", to: "test@test.ch" }));
      expect(result.error).toBe("PDF generation failed");
    });

    it("sends quote email, updates state, logs audit, and returns success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const mockQuote = {
        id: 1,
        documentNumber: "Q-2026-001",
        customer: {},
        items: [],
      };
      const mockSettings = { companyInfo: {} };
      vi.mocked(prisma.quote.findUnique).mockResolvedValue(mockQuote as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(
        mockSettings as never
      );
      vi.mocked(generateQuotePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendQuoteEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.quoteSentLog.create).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((arg) => {
        if (Array.isArray(arg)) return Promise.all(arg) as never;
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) as never;
      });

      const result = await sendQuote(
        {},
        form({ quoteId: "1", to: "info@kunde.ch", subject: "Offerte", body: "Guten Tag" })
      );

      expect(result.success).toBe(true);
      expect(generateQuotePdf).toHaveBeenCalledWith(mockQuote, mockSettings);
      expect(sendQuoteEmail).toHaveBeenCalledWith(
        mockQuote,
        mockSettings,
        expect.any(Buffer),
        expect.objectContaining({ to: "info@kunde.ch", subject: "Offerte", body: "Guten Tag" })
      );
      expect(logAudit).toHaveBeenCalledWith(
        editorSession,
        "SEND",
        "Quote",
        1,
        "Q-2026-001",
        { to: "info@kunde.ch" }
      );
      expect(revalidatePath).toHaveBeenCalledWith("/quotes/1");
    });
  });

  describe("convertQuoteToInvoice", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(convertQuoteToInvoice(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.quote.findUnique).not.toHaveBeenCalled();
    });

    it("returns error when quote not found", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue(null);
      const result = await convertQuoteToInvoice(1);
      expect(result.error).toBe("Offerte nicht gefunden.");
    });

    it("creates invoice, marks quote as Accepted, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 1,
        customerId: 10,
        customUserText: null,
        totalAmount: 500,
        items: [],
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        defaultPaymentTermDays: 30,
      } as never);
      vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-001");
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 99 } as never);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/invoices/99");
      });

      await expect(convertQuoteToInvoice(1)).rejects.toThrow("REDIRECT:/invoices/99");
      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 10,
          documentNumber: "I-2026-001",
          totalAmount: 500,
          state: "Draft",
        }),
      });
      expect(prisma.quote.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: "Accepted" },
      });
    });

    it("calculates due date using defaultPaymentTermDays from settings", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 2,
        customerId: 5,
        customUserText: null,
        totalAmount: 100,
        items: [],
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        defaultPaymentTermDays: 14,
      } as never);
      vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-002");

      let capturedDueDate: Date | undefined;
      vi.mocked(prisma.invoice.create).mockImplementation(async (args) => {
        capturedDueDate = (args.data as { dueDate?: Date }).dueDate;
        return { id: 100 } as never;
      });
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(convertQuoteToInvoice(2)).rejects.toThrow("REDIRECT");

      const expectedDueDate = new Date();
      expectedDueDate.setDate(expectedDueDate.getDate() + 14);
      expect(capturedDueDate?.getDate()).toBe(expectedDueDate.getDate());
    });

    it("copies items from quote to the new invoice", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 3,
        customerId: 7,
        customUserText: null,
        totalAmount: 200,
        items: [
          {
            name: "Entwicklung",
            description: "Web",
            unit: "Stunde",
            unitPrice: 200,
            quantity: 1,
            totalAmount: 200,
            customText: null,
            categoryId: null,
          },
        ],
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        defaultPaymentTermDays: 30,
      } as never);
      vi.mocked(generateInvoiceNumber).mockResolvedValue("I-2026-003");
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 101 } as never);
      vi.mocked(prisma.item.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(convertQuoteToInvoice(3)).rejects.toThrow("REDIRECT");
      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: "Entwicklung", invoiceId: 101 }),
        ]),
      });
    });
  });
});
