"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { requireEditor } from "@/lib/permissions";
import { requireModule } from "@/lib/module-guard";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";
import { WorkBillingError, createInvoiceFromWorkEntries } from "@/lib/work-invoicing";

const log = logger.child({ module: "work-billing" });

export async function createInvoiceFromEntries(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  await requireModule("timeTracking");

  const entryIds = formData.getAll("entryId").map((value) => parseInt(String(value), 10));
  let result: { id: number; entryCount: number };
  try {
    result = await createInvoiceFromWorkEntries(customerId, entryIds);
  } catch (err) {
    if (err instanceof WorkBillingError) return { error: err.message };
    log.error({ customerId, err }, "createInvoiceFromEntries failed");
    return { error: "Rechnungsentwurf konnte nicht erstellt werden." };
  }

  await logAudit(session, "CREATE", "Invoice", result.id, undefined, { fromWorkEntries: result.entryCount });
  revalidatePath("/time");
  revalidatePath("/time/open");
  revalidatePath("/invoices");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect(`/invoices/${result.id}`);
}
