import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findUnique: vi.fn() },
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

vi.mock("@/lib/credit-notes", () => ({
  CreditNoteError: class extends Error {},
  createCreditNoteDraft: vi.fn(),
  assertCreditWithinOriginal: vi.fn(),
  negateDocumentInput: vi.fn(),
}));

vi.mock("@/lib/document-actions", () => ({
  createDocumentWithItems: vi.fn(),
  updateDocumentWithItems: vi.fn(),
  sendDocument: vi.fn(),
  DocumentLockedError: class extends Error {},
}));

vi.mock("@/lib/payments", () => ({
  recordRemainingPayment: vi.fn(),
  recordPayment: vi.fn(),
  syncInvoiceState: vi.fn(),
  PaymentError: class extends Error {},
}));

vi.mock("@/lib/document-number", () => ({
  assignDocumentNumber: vi.fn(),
}));

vi.mock("@/lib/total-options", () => ({
  loadTotalOptions: vi.fn().mockResolvedValue({}),
}));

import { createCreditNote, updateInvoice } from "@/app/(app)/invoices/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { updateDocumentWithItems } from "@/lib/document-actions";
import {
  assertCreditWithinOriginal,
  createCreditNoteDraft,
  CreditNoteError,
  negateDocumentInput,
} from "@/lib/credit-notes";

const editorSession = {
  user: { id: "1", name: "Editor User", email: "editor@example.com", role: "Editor" },
} as never;

describe("createCreditNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits, then redirects to the edit page", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(createCreditNoteDraft).mockResolvedValue(42);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT:/invoices/42/edit");
    });

    await expect(createCreditNote(7)).rejects.toThrow("REDIRECT:/invoices/42/edit");
    expect(logAudit).toHaveBeenCalledWith(editorSession, "CREATE", "Invoice", 42, undefined, {
      creditNoteFor: 7,
    });
  });

  it("returns the validation message", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(createCreditNoteDraft).mockRejectedValue(new CreditNoteError("Nicht möglich."));

    expect(await createCreditNote(7)).toEqual({ error: "Nicht möglich." });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("updateInvoice for a credit note", () => {
  const item = {
    name: "Pos 1",
    description: "",
    unit: "Piece",
    unitPrice: 100,
    quantity: 1,
    discountPercent: 0,
    totalAmount: 0,
    customText: "",
    categoryId: null,
  };

  function form(items: object[], discountPercent = "0") {
    const fd = new FormData();
    fd.set("customerId", "1");
    fd.set("date", "2026-03-01");
    fd.set("discountPercent", discountPercent);
    fd.set("itemsJson", JSON.stringify(items));
    return fd;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ creditNoteForId: 7, customerId: 1 } as never);
    const actual = await vi.importActual<typeof import("@/lib/credit-notes")>("@/lib/credit-notes");
    vi.mocked(negateDocumentInput).mockImplementation(actual.negateDocumentInput);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT");
    });
  });

  it("stores a regular credit note negated", async () => {
    await expect(updateInvoice(42, {}, form([item]))).rejects.toThrow("REDIRECT");
    expect(vi.mocked(updateDocumentWithItems).mock.calls[0][1]).toMatchObject({ totalAmount: -100 });
  });

  it.each([
    ["a negative unit price", [{ ...item, unitPrice: -100 }]],
    ["a negative unit price next to a positive one", [{ ...item, unitPrice: -100 }, { ...item, unitPrice: 20 }]],
    ["a zero quantity", [{ ...item, quantity: 0 }]],
  ])("refuses %s, which would charge instead of credit", async (_label, items) => {
    const result = await updateInvoice(42, {}, form(items));
    expect(result.error).toMatch(/Gutschrift/);
    expect(updateDocumentWithItems).not.toHaveBeenCalled();
    expect(assertCreditWithinOriginal).not.toHaveBeenCalled();
  });

  it("refuses a credit note whose total is zero", async () => {
    const result = await updateInvoice(42, {}, form([item], "100"));
    expect(result.error).toMatch(/Gutschrift/);
    expect(updateDocumentWithItems).not.toHaveBeenCalled();
  });
});
