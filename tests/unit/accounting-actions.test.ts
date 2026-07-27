import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    expense: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
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

import { createExpense, updateExpense, deleteExpense } from "@/app/(app)/accounting/actions";
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
        createExpense({}, form({ date: "2026-01-15", description: "Büromaterial", amount: "50" }))
      ).rejects.toThrow("REDIRECT:/accounting");

      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: "Büromaterial",
          amount: 50,
        }),
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "CREATE", "Expense", 1, "Büromaterial");
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
