"use server";

import prisma from "@/lib/prisma";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { ActionState } from "@/hooks/use-action-toast";

export type SenderProfileFormState = ActionState;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_LENGTH = 100;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim() || null;

// Same normalisation as the company logo: PNG, at most 300 px, so pdfkit can render it.
async function readLogo(formData: FormData): Promise<Uint8Array<ArrayBuffer> | null | { error: string }> {
  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) return null;
  if (file.size > MAX_LOGO_BYTES) return { error: "Das Logo darf höchstens 2 MB gross sein." };
  try {
    const png = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize(300, 300, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(png.buffer as ArrayBuffer) as Uint8Array<ArrayBuffer>;
  } catch {
    return { error: "Das Logo konnte nicht gelesen werden (PNG, JPG, BMP oder WebP)." };
  }
}

function readFields(formData: FormData) {
  const name = text(formData, "name");
  const fields = {
    companyName: text(formData, "companyName"),
    companyHolderName: text(formData, "companyHolderName"),
    companyEmail: text(formData, "companyEmail"),
    companyPhone: text(formData, "companyPhone"),
  };
  if (!name) return { error: "Bezeichnung ist erforderlich." } as const;
  if ([name, ...Object.values(fields)].some((value) => (value?.length ?? 0) > MAX_FIELD_LENGTH)) {
    return { error: `Die Felder dürfen höchstens ${MAX_FIELD_LENGTH} Zeichen lang sein.` } as const;
  }
  return { name, ...fields };
}

export async function createSenderProfile(
  _prev: SenderProfileFormState,
  formData: FormData
): Promise<SenderProfileFormState> {
  const session = await requireAdmin();
  const fields = readFields(formData);
  if ("error" in fields) return { error: fields.error };
  const logo = await readLogo(formData);
  if (logo && "error" in logo) return { error: logo.error };

  const profile = await prisma.senderProfile.create({ data: { ...fields, logo } });
  await logAudit(session, "CREATE", "Settings", profile.id, `Absender-Profil ${profile.name}`);
  revalidatePath("/settings/sender-profiles");
  return { success: true, _ts: Date.now() };
}

export async function updateSenderProfile(
  id: number,
  _prev: SenderProfileFormState,
  formData: FormData
): Promise<SenderProfileFormState> {
  const session = await requireAdmin();
  const fields = readFields(formData);
  if ("error" in fields) return { error: fields.error };
  const logo = await readLogo(formData);
  if (logo && "error" in logo) return { error: logo.error };

  const existing = await prisma.senderProfile.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: "Absender-Profil nicht gefunden." };

  await prisma.senderProfile.update({
    where: { id },
    data: {
      ...fields,
      isActive: formData.get("isActive") === "on",
      ...(logo ? { logo } : {}),
      ...(formData.get("removeLogo") === "on" && !logo ? { logo: null } : {}),
    },
  });
  await logAudit(session, "UPDATE", "Settings", id, `Absender-Profil ${fields.name}`);
  revalidatePath("/settings/sender-profiles");
  return { success: true, _ts: Date.now() };
}

export async function deleteSenderProfile(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const profile = await prisma.senderProfile.findUnique({
    where: { id },
    include: { _count: { select: { invoices: true, quotes: true } } },
  });
  if (!profile) return { error: "Absender-Profil nicht gefunden." };

  // Deleting a used profile would change the look of drafts and quotes (re-rendered on every view).
  if (profile._count.invoices + profile._count.quotes > 0) {
    return { error: "Das Profil wird noch verwendet und kann nicht gelöscht werden. Setze es auf inaktiv." };
  }

  await prisma.senderProfile.delete({ where: { id } });
  await logAudit(session, "DELETE", "Settings", id, `Absender-Profil ${profile.name}`);
  revalidatePath("/settings/sender-profiles");
  return {};
}
