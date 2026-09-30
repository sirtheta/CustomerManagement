import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pendingReminder: { deleteMany: vi.fn() },
    payment: { count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/document-number", () => ({
  assignDocumentNumber: vi.fn(),
}));

vi.mock("@/lib/payments", () => ({
  recordRemainingPayment: vi.fn(),
  recordPayment: vi.fn(),
  syncInvoiceState: vi.fn(),
  toRappen: (v: number | { toNumber(): number }) =>
    Math.round((typeof v === "number" ? v : v.toNumber()) * 100),
  PaymentError: class extends Error {},
}));

import { updateInvoiceStatus, deleteInvoice } from "@/app/(app)/invoices/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { assignDocumentNumber } from "@/lib/document-number";
import { recordRemainingPayment, PaymentError } from "@/lib/payments";

const editorSession = {
  user: { id: "1", name: "Editor User", email: "editor@example.com", role: "Editor" },
} as never;

const adminSession = {
  user: { id: "2", name: "Admin User", email: "admin@example.com", role: "Admin" },
} as never;

function mockInvoice(state: string, documentNumber: string | null, totalAmount = 100) {
  // Payments exist exactly for Paid/PartiallyPaid invoices in these scenarios.
  vi.mocked(prisma.payment.count).mockResolvedValue(
    state === "Paid" || state === "PartiallyPaid" ? 1 : 0
  );
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    state,
    documentNumber,
    totalAmount,
  } as never);
}

describe("updateInvoiceStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordRemainingPayment).mockReset();
    vi.mocked(auth).mockResolvedValue(editorSession);
  });

  it("books the remaining amount as a manual payment when moving to Paid", async () => {
    mockInvoice("Sent", "I-25060001");

    const res = await updateInvoiceStatus(1, "Paid");

    expect(res).toEqual({});
    expect(recordRemainingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 1, source: "manual", actor: editorSession })
    );
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("refuses to leave Paid and changes nothing", async () => {
    mockInvoice("Paid", "I-25060002");

    const res = await updateInvoiceStatus(1, "Sent");

    expect(res.error).toBeTruthy();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses to leave PartiallyPaid", async () => {
    mockInvoice("PartiallyPaid", "I-25060002");

    const res = await updateInvoiceStatus(1, "Overdue");

    expect(res.error).toBeTruthy();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("derives the reset guard from existing payments, not from the state", async () => {
    mockInvoice("Sent", "I-25060002");
    vi.mocked(prisma.payment.count).mockResolvedValue(2);

    const res = await updateInvoiceStatus(1, "Overdue");

    expect(res).toEqual({ error: "Zum Zurücksetzen zuerst die Zahlungen löschen." });
    expect(prisma.payment.count).toHaveBeenCalledWith({ where: { invoiceId: 1 } });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("refuses to mark a canceled invoice as paid and assigns no number", async () => {
    mockInvoice("Canceled", null);

    const res = await updateInvoiceStatus(1, "Paid");

    expect(res).toEqual({ error: "Stornierte Rechnungen können nicht als bezahlt markiert werden." });
    expect(assignDocumentNumber).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(recordRemainingPayment).not.toHaveBeenCalled();
  });

  it("refuses PartiallyPaid as a target", async () => {
    mockInvoice("Sent", "I-25060002");

    const res = await updateInvoiceStatus(1, "PartiallyPaid");

    expect(res.error).toBeTruthy();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(recordRemainingPayment).not.toHaveBeenCalled();
  });

  it("returns an error and assigns no number for a zero-total invoice moving to Paid", async () => {
    mockInvoice("Draft", null, 0);

    const res = await updateInvoiceStatus(1, "Paid");

    expect(res.error).toBeTruthy();
    expect(assignDocumentNumber).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(recordRemainingPayment).not.toHaveBeenCalled();
  });

  it("returns a PaymentError from recordRemainingPayment as { error }", async () => {
    mockInvoice("Sent", "I-25060001");
    vi.mocked(recordRemainingPayment).mockRejectedValue(new PaymentError("Nicht möglich."));

    const res = await updateInvoiceStatus(1, "Paid");

    expect(res).toEqual({ error: "Nicht möglich." });
  });

  it("sets Sent first and logs it when a Draft goes to Paid", async () => {
    mockInvoice("Draft", "I-25060009");

    await updateInvoiceStatus(1, "Paid");

    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { state: "Sent" } });
    expect(logAudit).toHaveBeenCalledWith(editorSession, "STATUS", "Invoice", 1, "I-25060009", {
      from: "Draft",
      to: "Sent",
    });
    expect(vi.mocked(prisma.invoice.update).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(recordRemainingPayment).mock.invocationCallOrder[0]
    );
  });

  it("updates state and logs STATUS for Sent to Overdue", async () => {
    mockInvoice("Sent", "I-25060004");

    await updateInvoiceStatus(1, "Overdue");

    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { state: "Overdue" } });
    expect(logAudit).toHaveBeenCalledWith(editorSession, "STATUS", "Invoice", 1, "I-25060004", {
      from: "Sent",
      to: "Overdue",
    });
  });

  it("assigns a number when a draft leaves Draft", async () => {
    mockInvoice("Draft", null);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");

    await updateInvoiceStatus(10, "Sent");

    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 10, { actor: editorSession });
    expect(vi.mocked(assignDocumentNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.invoice.update).mock.invocationCallOrder[0]
    );
    expect(logAudit).toHaveBeenCalledWith(editorSession, "STATUS", "Invoice", 10, "R-26090001", {
      from: "Draft",
      to: "Sent",
    });
  });

  it.each(["Overdue", "Paid"] as const)("assigns a number when a draft goes straight to %s", async (state) => {
    mockInvoice("Draft", null);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");

    await updateInvoiceStatus(10, state);

    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 10, { actor: editorSession });
  });

  it("does not assign a number when a draft is canceled", async () => {
    mockInvoice("Draft", null);
    await updateInvoiceStatus(10, "Canceled");
    expect(assignDocumentNumber).not.toHaveBeenCalled();
  });

  it("assigns a number when a canceled, unnumbered invoice is sent", async () => {
    mockInvoice("Canceled", null);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");

    await updateInvoiceStatus(10, "Sent");

    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 10, { actor: editorSession });
    expect(logAudit).toHaveBeenCalledWith(editorSession, "STATUS", "Invoice", 10, "R-26090001", {
      from: "Canceled",
      to: "Sent",
    });
  });

  it("does not assign a number when an unnumbered canceled invoice stays canceled", async () => {
    mockInvoice("Canceled", null);
    await updateInvoiceStatus(10, "Canceled");
    expect(assignDocumentNumber).not.toHaveBeenCalled();
  });

  it("does not assign a number when a numbered invoice changes state", async () => {
    mockInvoice("Sent", "R-26090001");
    await updateInvoiceStatus(10, "Paid");
    expect(assignDocumentNumber).not.toHaveBeenCalled();
  });

  it("removes the pending reminder when leaving Overdue", async () => {
    mockInvoice("Overdue", "I-25060003");
    await updateInvoiceStatus(1, "Paid");
    expect(prisma.pendingReminder.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 1 } });
  });

  it("keeps the pending reminder when moving to Overdue", async () => {
    mockInvoice("Sent", "I-25060004");
    await updateInvoiceStatus(1, "Overdue");
    expect(prisma.pendingReminder.deleteMany).not.toHaveBeenCalled();
  });

  it("returns an error when the invoice does not exist", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);

    const res = await updateInvoiceStatus(999, "Paid");

    expect(res.error).toBeTruthy();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("deleteInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(adminSession);
    vi.mocked(prisma.payment.count).mockResolvedValue(0 as never);
  });

  it("returns an error and does not delete when payments exist", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      documentNumber: "I-25060007",
    } as never);
    vi.mocked(prisma.payment.count).mockResolvedValue(2 as never);

    const result = await deleteInvoice(1);

    expect(result.error).toBeTruthy();
    expect(prisma.invoice.delete).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("deletes the invoice, writes an audit log, and redirects", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      documentNumber: "I-25060005",
    } as never);
    vi.mocked(prisma.invoice.delete).mockResolvedValue({} as never);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT:/invoices");
    });

    await expect(deleteInvoice(1)).rejects.toThrow("REDIRECT:/invoices");
    expect(prisma.invoice.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Invoice", 1, "I-25060005");
  });

  it("returns an error instead of throwing when the delete fails", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      documentNumber: "I-25060006",
    } as never);
    vi.mocked(prisma.invoice.delete).mockRejectedValue(new Error("FOREIGN KEY constraint failed"));

    const result = await deleteInvoice(1);

    expect(result.error).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
