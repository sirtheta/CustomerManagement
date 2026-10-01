import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    customerContact: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { createContact, updateContact, deleteContact } from "@/app/(app)/customers/contact-actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

const editor = { user: { id: "1", name: "E", email: "e@test.ch", role: "Editor" } } as never;
const viewer = { user: { id: "3", name: "V", email: "v@test.ch", role: "Viewer" } } as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("contact actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editor);
    vi.mocked(prisma.customerContact.create).mockResolvedValue({ contactId: 7, name: "Buchhaltung" } as never);
    vi.mocked(prisma.customerContact.delete).mockResolvedValue({ contactId: 7, name: "Buchhaltung" } as never);
  });

  it("rejects viewers", async () => {
    vi.mocked(auth).mockResolvedValue(viewer);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT:/dashboard");
    });
    await expect(createContact(1, {}, form({ name: "X" }))).rejects.toThrow("REDIRECT");
    expect(prisma.customerContact.create).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const result = await createContact(1, {}, form({ name: "  " }));
    expect(result.error).toBe("Name ist erforderlich");
    expect(prisma.customerContact.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid e-mail", async () => {
    const result = await createContact(1, {}, form({ name: "X", email: "kaputt" }));
    expect(result.error).toBe("Ungültige E-Mail-Adresse");
  });

  it("creates a contact, trims and nulls empty fields, and audits", async () => {
    const result = await createContact(1, {}, form({ name: " Buchhaltung ", role: "", email: "b@x.ch", phone: "" }));
    expect(result.success).toBe(true);
    expect(prisma.customerContact.create).toHaveBeenCalledWith({
      data: { customerId: 1, name: "Buchhaltung", role: null, email: "b@x.ch", phone: null },
    });
    expect(logAudit).toHaveBeenCalledWith(editor, "CREATE", "CustomerContact", 7, "Buchhaltung");
  });

  it("updates a contact", async () => {
    const result = await updateContact(1, 7, {}, form({ name: "Einkauf", role: "Einkauf" }));
    expect(result.success).toBe(true);
    expect(prisma.customerContact.update).toHaveBeenCalledWith({
      where: { contactId: 7, customerId: 1 },
      data: { name: "Einkauf", role: "Einkauf", email: null, phone: null },
    });
    expect(logAudit).toHaveBeenCalledWith(editor, "UPDATE", "CustomerContact", 7, "Einkauf");
  });

  it("deletes a contact as editor and audits", async () => {
    await deleteContact(1, 7);
    expect(prisma.customerContact.delete).toHaveBeenCalledWith({ where: { contactId: 7, customerId: 1 } });
    expect(logAudit).toHaveBeenCalledWith(editor, "DELETE", "CustomerContact", 7, "Buchhaltung");
  });
});
