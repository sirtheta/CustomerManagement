import type { PrismaClient } from "@prisma/client";
import defaultPrisma from "@/lib/prisma";
import type { TotalOptions } from "@/lib/calculations";

/** Reads how document totals are rounded (Einstellungen -> Rechnungsbetrag auf 5 Rappen runden). */
export async function loadTotalOptions(
  db: Pick<PrismaClient, "applicationSettings"> = defaultPrisma
): Promise<TotalOptions> {
  const settings = await db.applicationSettings.findFirst({
    select: { roundTotalTo5Rappen: true },
  });
  return { roundTo5Rappen: settings?.roundTotalTo5Rappen ?? false };
}
