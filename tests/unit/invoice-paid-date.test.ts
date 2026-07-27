import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
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
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import { updateInvoiceStatus, updateInvoicePaidDate, deleteInvoice } from "@/app/(app)/invoices/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

const editorSession = {
  user: { id: "1", name: "Editor User", email: "editor@example.com", role: "Editor" },
} as never;

const adminSession = {
  user: { id: "2", name: "Admin User", email: "admin@example.com", role: "Admin" },
} as never;

describe("updateInvoiceStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
  });

  it("sets paidDate when moving to Paid", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      state: "Sent",
      documentNumber: "I-25060001",
    } as never);

    await updateInvoiceStatus(1, "Paid");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { state: "Paid", paidDate: expect.any(Date) },
    });
    expect(logAudit).toHaveBeenCalledWith(editorSession, "STATUS", "Invoice", 1, "I-25060001", {
      from: "Sent",
      to: "Paid",
    });
  });

  it("clears paidDate when moving away from Paid", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      state: "Paid",
      documentNumber: "I-25060002",
    } as never);

    await updateInvoiceStatus(1, "Sent");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { state: "Sent", paidDate: null },
    });
  });

  it("does not touch paidDate for other transitions", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      state: "Draft",
      documentNumber: "I-25060003",
    } as never);

    await updateInvoiceStatus(1, "Sent");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { state: "Sent" },
    });
  });

  it("does nothing when the invoice does not exist", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);

    await updateInvoiceStatus(999, "Paid");

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("updateInvoicePaidDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
  });

  it("overwrites the paid date and writes an audit log", async () => {
    vi.mocked(prisma.invoice.update).mockResolvedValue({
      documentNumber: "I-25060004",
    } as never);

    await updateInvoicePaidDate(1, "2026-01-10");

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { paidDate: new Date("2026-01-10") },
      select: { documentNumber: true },
    });
    expect(logAudit).toHaveBeenCalledWith(
      editorSession,
      "UPDATE",
      "Invoice",
      1,
      "I-25060004",
      { paidDate: new Date("2026-01-10") }
    );
  });

  it("ignores an invalid date string", async () => {
    await updateInvoicePaidDate(1, "not-a-date");

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("deleteInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(adminSession);
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
