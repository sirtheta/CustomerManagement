import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { createCustomer, updateCustomer, deleteCustomer } from "@/app/(app)/customers/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

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

const VALID_FIELDS = {
  contactPerson: "Max Muster",
  address: "Seestrasse 1",
  city: "Zürich",
  zipCode: "8001",
  email: "max@muster.ch",
};

describe("customer actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCustomer", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(createCustomer({}, form({}))).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("returns fieldErrors for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await createCustomer({}, form({}));
      expect(result.error).toBe("Bitte alle Pflichtfelder korrekt ausfüllen.");
      expect(result.fieldErrors?.contactPerson).toBeDefined();
      expect(result.fieldErrors?.address).toBeDefined();
      expect(result.fieldErrors?.city).toBeDefined();
      expect(result.fieldErrors?.zipCode).toBeDefined();
      expect(result.fieldErrors?.email).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("returns fieldError for invalid email format", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await createCustomer({}, form({ ...VALID_FIELDS, email: "not-an-email" }));
      expect(result.fieldErrors?.email).toBe("Ungültige E-Mail-Adresse.");
    });

    it("creates customer, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 42 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/customers");
      });

      await expect(createCustomer({}, form(VALID_FIELDS))).rejects.toThrow(
        "REDIRECT:/customers"
      );
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contactPerson: "Max Muster",
          email: "max@muster.ch",
          zipCode: "8001",
          yearlyInvoice: false,
          contactInsteadOfCompany: false,
          nextInvoiceDate: null,
        }),
      });
      expect(logAudit).toHaveBeenCalledWith(
        editorSession,
        "CREATE",
        "Customer",
        42,
        "Max Muster"
      );
    });

    it("sets yearlyInvoice and contactInsteadOfCompany to true when 'on'", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        createCustomer(
          {},
          form({ ...VALID_FIELDS, yearlyInvoice: "on", contactInsteadOfCompany: "on" })
        )
      ).rejects.toThrow("REDIRECT");
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ yearlyInvoice: true, contactInsteadOfCompany: true }),
      });
    });

    it("parses nextInvoiceDate when provided", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        createCustomer({}, form({ ...VALID_FIELDS, yearlyInvoice: "on", nextInvoiceDate: "2027-01-01" }))
      ).rejects.toThrow("REDIRECT");
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ nextInvoiceDate: new Date("2027-01-01") }),
      });
    });

    it("ignores nextInvoiceDate when yearlyInvoice is not enabled", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        createCustomer({}, form({ ...VALID_FIELDS, nextInvoiceDate: "2027-01-01" }))
      ).rejects.toThrow("REDIRECT");
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ yearlyInvoice: false, nextInvoiceDate: null }),
      });
    });

    it("accepts nullable company and phone fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        createCustomer({}, form({ ...VALID_FIELDS, company: "Muster AG", phone: "+41 44 000 00 00" }))
      ).rejects.toThrow("REDIRECT");
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ company: "Muster AG", phone: "+41 44 000 00 00" }),
      });
    });
  });

  describe("updateCustomer", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(updateCustomer(1, {}, form({}))).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("returns fieldErrors for missing required fields", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await updateCustomer(1, {}, form({}));
      expect(result.error).toBe("Bitte alle Pflichtfelder korrekt ausfüllen.");
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("updates customer, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/customers/5");
      });

      await expect(updateCustomer(5, {}, form(VALID_FIELDS))).rejects.toThrow(
        "REDIRECT:/customers/5"
      );
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { customerId: 5 },
        data: expect.objectContaining({ contactPerson: "Max Muster", email: "max@muster.ch" }),
      });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "UPDATE", "Customer", 5, "Max Muster");
    });
  });

  describe("deleteCustomer", () => {
    it("rejects Editor role (Admin only)", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(deleteCustomer(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });

    it("deletes customer, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.customer.delete).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/customers");
      });

      await expect(deleteCustomer(7)).rejects.toThrow("REDIRECT:/customers");
      expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { customerId: 7 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Customer", 7);
    });
  });
});
