"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function field(formData: FormData, key: string): string | null {
  return ((formData.get(key) as string) ?? "").trim() || null;
}

function readContact(formData: FormData):
  | { data: { name: string; role: string | null; email: string | null; phone: string | null } }
  | { error: string } {
  const name = field(formData, "name");
  if (!name) return { error: "Name ist erforderlich" };
  if (name.length > 200) return { error: "Name zu lang (max. 200 Zeichen)" };
  const email = field(formData, "email");
  if (email && !z.string().email().safeParse(email).success) return { error: "Ungültige E-Mail-Adresse" };
  return { data: { name, role: field(formData, "role"), email, phone: field(formData, "phone") } };
}

export async function createContact(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = readContact(formData);
  if ("error" in parsed) return { error: parsed.error, _ts: Date.now() };

  const contact = await prisma.customerContact.create({ data: { customerId, ...parsed.data } });
  await logAudit(session, "CREATE", "CustomerContact", contact.contactId, parsed.data.name);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function updateContact(
  customerId: number,
  contactId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = readContact(formData);
  if ("error" in parsed) return { error: parsed.error, _ts: Date.now() };

  // Scoped to the customer so a stale or forged id cannot touch another customer's contact.
  await prisma.customerContact.update({ where: { contactId, customerId }, data: parsed.data });
  await logAudit(session, "UPDATE", "CustomerContact", contactId, parsed.data.name);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function deleteContact(customerId: number, contactId: number): Promise<void> {
  const session = await requireEditor();
  const contact = await prisma.customerContact.delete({ where: { contactId, customerId } });
  await logAudit(session, "DELETE", "CustomerContact", contactId, contact.name);
  revalidatePath(`/customers/${customerId}`);
}
