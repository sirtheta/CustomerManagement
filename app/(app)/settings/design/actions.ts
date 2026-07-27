"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { resolveTheme } from "@/lib/pdf/theme";
import type { ActionState } from "@/hooks/use-action-toast";

export async function savePdfTheme(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireAdmin();

  const settings = await prisma.applicationSettings.findFirst();
  if (!settings) {
    return { error: "Bitte zuerst die Firmendaten unter Einstellungen speichern." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse((formData.get("theme") as string) || "{}");
  } catch {
    return { error: "Ungültige Design-Daten." };
  }

  // Normalize/validate before persisting so only sane values reach the DB.
  const theme = resolveTheme(parsed);

  await prisma.applicationSettings.update({
    where: { applicationSettingsId: settings.applicationSettingsId },
    data: { pdfTheme: theme },
  });

  await logAudit(session, "UPDATE", "Settings", undefined, "PDF-Design", { theme });

  revalidatePath("/settings/design");
  return { success: true, _ts: Date.now() };
}
