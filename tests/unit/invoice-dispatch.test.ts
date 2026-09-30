import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock("@/lib/document-archive", () => ({ archivePdf: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { archivePdf } from "@/lib/document-archive";
import { logAudit } from "@/lib/audit";

const actor = { user: { id: "7", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;
const invoice = { id: 1, documentNumber: "I-26090001", customer: {}, items: [] } as never;
const settings = { companyInfo: {} } as never;
const mail = { to: "a@b.ch", subject: "s", body: "b" };
const archive = { path: "2026/x.pdf", sha256: "a".repeat(64), size: 3 };

describe("renderArchiveAndSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(archivePdf).mockResolvedValue(archive);
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
  });

  it("archives the exact bytes before sending them", async () => {
    const result = await renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail });

    expect(result).toEqual(archive);
    expect(vi.mocked(archivePdf).mock.calls[0][0]).toMatchObject({
      documentNumber: "I-26090001",
      kind: "Invoice",
    });
    expect(vi.mocked(archivePdf).mock.calls[0][0].pdf).toEqual(Buffer.from("pdf"));
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][2]).toEqual(Buffer.from("pdf"));
    expect(vi.mocked(archivePdf).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendInvoiceEmail).mock.invocationCallOrder[0]
    );
  });

  it("does not send when archiving fails", async () => {
    vi.mocked(archivePdf).mockRejectedValue(new Error("EACCES"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail })).rejects.toThrow(
      "PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet."
    );
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("passes a PDF generation error through unchanged and archives nothing", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValue(new Error("PDF error"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail })).rejects.toThrow("PDF error");
    expect(archivePdf).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("passes a send error through unchanged", async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error("SMTP down"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Reminder", mail })).rejects.toThrow("SMTP down");
  });

  it("forwards PDF options such as the QR amount", async () => {
    await renderArchiveAndSend({ invoice, settings, kind: "Reminder", mail, pdfOptions: { qrAmount: 12.5 } });
    expect(generateInvoicePdf).toHaveBeenCalledWith(invoice, settings, { qrAmount: 12.5 });
  });

  it("refuses an invoice without a number", async () => {
    await expect(
      renderArchiveAndSend({ invoice: { id: 1, documentNumber: null } as never, settings, kind: "Invoice", mail })
    ).rejects.toThrow("Rechnung hat noch keine Nummer.");
    expect(archivePdf).not.toHaveBeenCalled();
  });
});

describe("sentDocumentData", () => {
  it("builds the create input including the acting user", () => {
    expect(
      sentDocumentData({
        invoiceId: 1,
        documentNumber: "I-26090001",
        kind: "Reminder",
        reminderLevel: 2,
        archive,
        sentTo: "a@b.ch",
        subject: "Mahnung",
        actor,
      })
    ).toEqual({
      invoiceId: 1,
      kind: "Reminder",
      reminderLevel: 2,
      documentNumber: "I-26090001",
      path: "2026/x.pdf",
      sha256: "a".repeat(64),
      size: 3,
      sentTo: "a@b.ch",
      subject: "Mahnung",
      createdById: 7,
    });
  });

  it("stores no reminder level for an invoice", () => {
    const data = sentDocumentData({
      invoiceId: 1,
      documentNumber: "I-1",
      kind: "Invoice",
      archive,
      sentTo: "a@b.ch",
      subject: "s",
      actor,
    });
    expect(data.reminderLevel).toBeNull();
  });
});

describe("auditArchived", () => {
  it("logs a CREATE entry for the SentDocument with hash and path", async () => {
    await auditArchived(actor, { id: 42 }, "I-26090001", archive);
    expect(logAudit).toHaveBeenCalledWith(actor, "CREATE", "SentDocument", 42, "I-26090001", {
      sha256: "a".repeat(64),
      path: "2026/x.pdf",
    });
  });
});
