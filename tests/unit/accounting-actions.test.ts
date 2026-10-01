import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    expense: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    expenseReceipt: {
      findUnique: vi.fn(),
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
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import {
  createExpense,
  updateExpense,
  deleteExpense,
  deleteExpenseReceipt,
} from "@/app/(app)/accounting/actions";
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

const viewerSession = {
  user: { id: "3", name: "Viewer User", email: "viewer@example.com", role: "Viewer" },
} as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("accounting actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createExpense", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });

      await expect(
        createExpense({}, form({ date: "2026-01-15", description: "Büromaterial", amount: "50" }))
      ).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it("returns field errors for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);

      const result = await createExpense({}, form({}));
      expect(result.fieldErrors?.date).toBeDefined();
      expect(result.fieldErrors?.description).toBeDefined();
      expect(result.fieldErrors?.amount).toBeDefined();
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it("rejects a non-positive amount", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);

      const result = await createExpense(
        {},
        form({ date: "2026-01-15", description: "Büromaterial", amount: "-10" })
      );
      expect(result.fieldErrors?.amount).toBe("Betrag muss eine positive Zahl sein.");
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it("creates an expense and writes an audit log for Editor", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.expense.create).mockResolvedValue({
        id: 1,
        description: "Büromaterial",
      } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/accounting");
      });

      await expect(
        createExpense(
          {},
          form({ date: "2026-01-15", description: "Büromaterial", amount: "50", paid: "on" })
        )
      ).rejects.toThrow("REDIRECT:/accounting");

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: "Büromaterial",
          amount: 50,
          paidDate: new Date("2026-01-15"),
        }),
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "CREATE", "Expense", 1, "Büromaterial");
    });

    it("stores an open supplier invoice without paidDate", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.expense.create).mockResolvedValue({ id: 2, description: "Hosting" } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/accounting");
      });

      await expect(
        createExpense(
          {},
          form({
            date: "2026-01-15",
            description: "Hosting",
            amount: "99",
            supplier: " Muster AG ",
            dueDate: "2026-02-14",
          })
        )
      ).rejects.toThrow("REDIRECT:/accounting");

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplier: "Muster AG",
          dueDate: new Date("2026-02-14"),
          paidDate: null,
        }),
      });
    });

    it("stores valid receipts with the expense", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.expense.create).mockResolvedValue({ id: 3, description: "Papier" } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/accounting");
      });
      const fd = form({ date: "2026-01-15", description: "Papier", amount: "10" });
      fd.append("receipts", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "beleg.pdf"));

      await expect(createExpense({}, fd)).rejects.toThrow("REDIRECT:/accounting");

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          receipts: {
            create: [expect.objectContaining({ name: "beleg.pdf", fileType: ".pdf", size: 5 })],
          },
        }),
      });
    });

    it("rejects a receipt whose content does not match its extension", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const fd = form({ date: "2026-01-15", description: "Papier", amount: "10" });
      fd.append("receipts", new File(["<html></html>"], "beleg.pdf"));

      const result = await createExpense({}, fd);

      expect(result.error).toContain("entspricht nicht");
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it("rejects a receipt with a disallowed file type", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const fd = form({ date: "2026-01-15", description: "Papier", amount: "10" });
      fd.append("receipts", new File(["x"], "beleg.exe"));

      const result = await createExpense({}, fd);

      expect(result.error).toContain("nicht erlaubt");
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });

  describe("updateExpense", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });

      await expect(
        updateExpense(1, {}, form({ date: "2026-01-15", description: "Miete", amount: "1200" }))
      ).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });

    it("updates an expense and writes an audit log for Admin", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.expense.update).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/accounting");
      });

      await expect(
        updateExpense(1, {}, form({ date: "2026-01-15", description: "Miete", amount: "1200" }))
      ).rejects.toThrow("REDIRECT:/accounting");

      expect(prisma.expense.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ description: "Miete", amount: 1200 }),
      });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "UPDATE", "Expense", 1, "Miete");
    });
  });

  describe("deleteExpenseReceipt", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });

      await expect(deleteExpenseReceipt(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.expenseReceipt.delete).not.toHaveBeenCalled();
    });

    it("deletes a receipt and writes an audit log for Admin", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.expenseReceipt.findUnique).mockResolvedValue({
        expenseId: 4,
        name: "beleg.pdf",
      } as never);
      vi.mocked(prisma.expenseReceipt.delete).mockResolvedValue({} as never);

      await deleteExpenseReceipt(9);

      expect(prisma.expenseReceipt.delete).toHaveBeenCalledWith({ where: { id: 9 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "ExpenseReceipt", 9, "beleg.pdf");
    });
  });

  describe("deleteExpense", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });

      await expect(deleteExpense(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.expense.delete).not.toHaveBeenCalled();
    });

    it("deletes an expense and writes an audit log for Admin", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.expense.findUnique).mockResolvedValue({ description: "Miete" } as never);
      vi.mocked(prisma.expense.delete).mockResolvedValue({} as never);

      await deleteExpense(1);

      expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Expense", 1, "Miete");
    });
  });
});
