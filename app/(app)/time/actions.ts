"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { requireModule } from "@/lib/module-guard";
import { logAudit } from "@/lib/audit";
import { assertCustomerActive } from "@/lib/customer-archive";
import {
  MAX_NOTE_LENGTH,
  parseQuantity,
  parseWorkDate,
  resolveWorkEntry,
  roundQuantity,
  validateQuantity,
} from "@/lib/work-entries";

export type WorkEntryState = ActionState & { entryId?: number };

const BILLED_ERROR = "Der Eintrag ist bereits verrechnet oder existiert nicht mehr.";

function revalidate() {
  revalidatePath("/time");
  revalidatePath("/time/open");
  revalidatePath("/time/open/[customerId]", "page");
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createWorkEntry(_prev: WorkEntryState, formData: FormData): Promise<WorkEntryState> {
  const session = await requireEditor();
  await requireModule("timeTracking");

  const customerId = parseInt(text(formData, "customerId"), 10);
  const date = parseWorkDate(text(formData, "date"));
  if (!Number.isInteger(customerId) || !date) return { error: "Bitte Kunde und Datum angeben." };

  const customerError = await assertCustomerActive(prisma, customerId);
  if (customerError) return { error: customerError };

  const serviceIdRaw = text(formData, "serviceId");
  const serviceId = serviceIdRaw ? parseInt(serviceIdRaw, 10) : null;
  if (serviceIdRaw && !Number.isInteger(serviceId)) return { error: "Leistung nicht gefunden." };
  const service =
    serviceId === null
      ? null
      : await prisma.service.findUnique({
          where: { id: serviceId },
          select: { id: true, name: true, unit: true, isActive: true },
        });

  const resolved = resolveWorkEntry(
    {
      quantityRaw: text(formData, "quantity"),
      serviceId,
      freeName: text(formData, "freeName"),
      freeUnit: text(formData, "freeUnit"),
      note: text(formData, "note"),
    },
    service
  );
  if ("error" in resolved) return { error: resolved.error };
  const { name, unit, quantity, note } = resolved.value;

  const entry = await prisma.workEntry.create({
    data: {
      customerId,
      date,
      serviceId: service?.id ?? null,
      name,
      unit,
      quantity,
      note,
      createdById: parseInt(session.user.id, 10),
    },
  });
  await logAudit(session, "CREATE", "WorkEntry", entry.id, name, { customerId, unit, quantity });
  revalidate();
  return { success: true, _ts: Date.now(), entryId: entry.id };
}

export async function updateWorkEntry(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("timeTracking");

  const date = parseWorkDate(text(formData, "date"));
  if (!date) return { error: "Bitte ein gültiges Datum angeben." };

  const existing = await prisma.workEntry.findUnique({
    where: { id },
    select: { unit: true, name: true, customerId: true, invoiceId: true },
  });
  if (!existing || existing.invoiceId !== null) return { error: BILLED_ERROR };

  const parsedQuantity = parseQuantity(text(formData, "quantity"));
  if (parsedQuantity === null) return { error: "Bitte eine gültige Menge angeben." };
  const quantityError = validateQuantity(parsedQuantity, existing.unit);
  if (quantityError) return { error: quantityError };
  const quantity = roundQuantity(parsedQuantity);

  const note = text(formData, "note").trim();
  if (note.length > MAX_NOTE_LENGTH) return { error: `Die Notiz ist zu lang (max. ${MAX_NOTE_LENGTH} Zeichen).` };

  // invoiceId: null in the filter closes the race with a billing that runs at the same moment.
  const { count } = await prisma.workEntry.updateMany({
    where: { id, invoiceId: null },
    data: { date, quantity, note: note || null },
  });
  if (count === 0) return { error: BILLED_ERROR };

  await logAudit(session, "UPDATE", "WorkEntry", id, existing.name, { customerId: existing.customerId, quantity });
  revalidate();
  return { success: true, _ts: Date.now() };
}

export async function deleteWorkEntry(id: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  await requireModule("timeTracking");

  const existing = await prisma.workEntry.findUnique({
    where: { id },
    select: { name: true, customerId: true },
  });
  if (!existing) return { error: BILLED_ERROR };

  const { count } = await prisma.workEntry.deleteMany({ where: { id, invoiceId: null } });
  if (count === 0) return { error: BILLED_ERROR };

  await logAudit(session, "DELETE", "WorkEntry", id, existing.name, { customerId: existing.customerId });
  revalidate();
  return {};
}
