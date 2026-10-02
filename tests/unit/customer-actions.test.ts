import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), aggregate: vi.fn() },
    invoice: { count: vi.fn() },
    item: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  archiveCustomer,
  restoreCustomer,
} from "@/app/(app)/customers/actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
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
  street: "Seestrasse", houseNumber: "1",
  city: "Zürich",
  zipCode: "8001",
  email: "max@muster.ch",
};

describe("customer actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.aggregate).mockResolvedValue({ _max: { customerNumber: null } } as never);
    vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
    // vi.clearAllMocks() keeps implementations: an earlier test leaves redirect throwing.
    vi.mocked(redirect).mockImplementation(() => undefined as never);
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
      expect(result.fieldErrors?.street).toBeDefined();
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
          contactInsteadOfCompany: false,
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

    it("sets contactInsteadOfCompany to true when 'on'", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT");
      });

      await expect(
        createCustomer({}, form({ ...VALID_FIELDS, contactInsteadOfCompany: "on" }))
      ).rejects.toThrow("REDIRECT");
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactInsteadOfCompany: true }),
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
      // Top-customer names come from the cached analytics payload.
      expect(revalidateTag).toHaveBeenCalledWith("analytics", { expire: 0 });
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

    it("refuses deletion when the customer has invoices", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.invoice.count).mockResolvedValue(3);

      const res = await deleteCustomer(7);

      expect(res).toEqual({
        error: "Der Kunde hat Rechnungen und kann nicht gelöscht werden. Bitte archivieren.",
      });
      expect(prisma.invoice.count).toHaveBeenCalledWith({ where: { customerId: 7 } });
      expect(prisma.customer.delete).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("deletes a customer without invoices, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.invoice.count).mockResolvedValue(0);
      vi.mocked(prisma.customer.delete).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/customers");
      });

      await expect(deleteCustomer(7)).rejects.toThrow("REDIRECT:/customers");
      expect(prisma.item.deleteMany).toHaveBeenCalledWith({ where: { quote: { customerId: 7 } } });
      expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { customerId: 7 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Customer", 7);
    });
  });

  describe("archiveCustomer / restoreCustomer", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(archiveCustomer(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("archives, audits, and hides the customer", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

      const res = await archiveCustomer(4);

      expect(res).toEqual({});
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { customerId: 4 },
        data: { archivedAt: expect.any(Date) },
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Customer", 4, undefined, {
        archived: true,
      });
    });

    it("restores and audits", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

      await restoreCustomer(4);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { customerId: 4 },
        data: { archivedAt: null },
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Customer", 4, undefined, {
        archived: false,
      });
    });
  });

  describe("extended customer fields", () => {
    const BILLING = {
      billingName: "Muster AG, Buchhaltung",
      billingStreet: "Postfach",
      billingZipCode: "3000",
      billingCity: "Bern",
    };

    async function create(fields: Record<string, string>) {
      vi.mocked(auth).mockResolvedValue(editorSession);
      return createCustomer({}, form({ ...VALID_FIELDS, ...fields }));
    }

    it("assigns the next customer number automatically", async () => {
      vi.mocked(prisma.customer.aggregate).mockResolvedValue({ _max: { customerNumber: 1041 } } as never);
      await create({});
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 1042 }) })
      );
    });

    it("returns the submitted values with validation errors so the form can refill", async () => {
      const result = await create({ company: "Muster AG", uid: "CHE-116.281.711", billingCity: "Bern" });
      expect(result.fieldErrors?.uid).toBeDefined();
      expect(result.values).toMatchObject({
        company: "Muster AG",
        contactPerson: "Max Muster",
        email: "max@muster.ch",
        uid: "CHE-116.281.711",
        billingCity: "Bern",
      });
    });

    it("returns the submitted values with a duplicate customer number", async () => {
      vi.mocked(prisma.customer.create).mockRejectedValueOnce(
        Object.assign(new Error("unique"), { code: "P2002" })
      );
      const result = await create({ customerNumber: "77", company: "Muster AG" });
      expect(result.fieldErrors?.customerNumber).toBe("Kundennummer bereits vergeben.");
      expect(result.values).toMatchObject({ customerNumber: "77", company: "Muster AG" });
    });

    it("does not return values on success", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      const result = await createCustomer({}, form(VALID_FIELDS));
      expect(result?.values).toBeUndefined();
    });

    it("keeps an explicit customer number", async () => {
      await create({ customerNumber: "77" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 77 }) })
      );
    });

    it("rejects a non-numeric customer number", async () => {
      const result = await create({ customerNumber: "K-1" });
      expect(result.fieldErrors?.customerNumber).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("reports a duplicate customer number", async () => {
      vi.mocked(prisma.customer.create).mockRejectedValueOnce(
        Object.assign(new Error("unique"), { code: "P2002", name: "PrismaClientKnownRequestError" })
      );
      const result = await create({ customerNumber: "77" });
      expect(result.fieldErrors?.customerNumber).toBe("Kundennummer bereits vergeben.");
    });

    it("retries an automatic number once after a collision", async () => {
      vi.mocked(prisma.customer.aggregate)
        .mockResolvedValueOnce({ _max: { customerNumber: 1001 } } as never)
        .mockResolvedValueOnce({ _max: { customerNumber: 1002 } } as never);
      vi.mocked(prisma.customer.create)
        .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
        .mockResolvedValueOnce({ customerId: 5 } as never);
      await create({});
      expect(prisma.customer.create).toHaveBeenCalledTimes(2);
      expect(prisma.customer.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 1003 }) })
      );
    });

    it("normalizes a valid UID and rejects an invalid one", async () => {
      await create({ uid: "che116281710 mwst" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ uid: "CHE-116.281.710" }) })
      );
      vi.mocked(prisma.customer.create).mockClear();
      const result = await create({ uid: "CHE-116.281.711" });
      expect(result.fieldErrors?.uid).toContain("Prüfziffer stimmt nicht");
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("names the format error separately and gives a valid example", async () => {
      const result = await create({ uid: "CHE-12.345" });
      expect(result.fieldErrors?.uid).toContain("UID-Format");
      expect(result.fieldErrors?.uid).toContain("CHE-123.456.788");
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("saves a complete billing address with default country", async () => {
      await create({ ...BILLING, billingEmail: "buchhaltung@muster.ch" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billingName: "Muster AG, Buchhaltung",
            billingStreet: "Postfach",
            billingZipCode: "3000",
            billingCity: "Bern",
            billingCountry: "CH",
            billingEmail: "buchhaltung@muster.ch",
          }),
        })
      );
    });

    it("rejects a partial billing address", async () => {
      const result = await create({ billingStreet: "Postfach", billingCity: "Bern" });
      expect(result.fieldErrors?.billingStreet).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("drops billing name and country when there is no billing address", async () => {
      await create({ billingName: "Nur Name", billingCountry: "DE" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ billingName: null, billingCountry: null, billingStreet: null }),
        })
      );
    });

    it("rejects an invalid billing e-mail", async () => {
      const result = await create({ billingEmail: "kaputt" });
      expect(result.fieldErrors?.billingEmail).toBeDefined();
    });

    it("validates the payment term (1-365 days)", async () => {
      for (const bad of ["0", "366", "abc", "-5"]) {
        const result = await create({ paymentTermDays: bad });
        expect(result.fieldErrors?.paymentTermDays).toBeDefined();
      }
      expect(prisma.customer.create).not.toHaveBeenCalled();
      await create({ paymentTermDays: "10" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentTermDays: 10 }) })
      );
    });

    it("stores no payment term when the field is empty", async () => {
      await create({ paymentTermDays: "" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentTermDays: null }) })
      );
    });

    it("update never changes the customer number", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      await updateCustomer(3, {}, form({ ...VALID_FIELDS, customerNumber: "9" }));
      const data = vi.mocked(prisma.customer.update).mock.calls[0][0].data as Record<string, unknown>;
      expect("customerNumber" in data).toBe(false);
    });
  });
});
