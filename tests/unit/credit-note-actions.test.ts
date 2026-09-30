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
  toRappen: (v: number) => Math.round(v * 100),
  PaymentError: class extends Error {},
}));

vi.mock("@/lib/document-number", () => ({
  assignDocumentNumber: vi.fn(),
}));

import { createCreditNote } from "@/app/(app)/invoices/actions";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { createCreditNoteDraft, CreditNoteError } from "@/lib/credit-notes";

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
