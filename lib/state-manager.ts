import type { PrismaClient } from "@prisma/client";

/**
 * Marks overdue invoices (state=Sent, dueDate < now) as Overdue,
 * and expired quotes (state=Sent, validUntil < now) as Expired.
 *
 * Accepts a PrismaClient so it can be injected from tests or called
 * from a cron job / page loader with the global singleton.
 */
export async function checkAndUpdateDocumentStates(
  prisma: PrismaClient,
  invoiceIds: number[],
  quoteIds: number[]
): Promise<void> {
  const now = new Date();

  if (invoiceIds.length > 0) {
    await prisma.invoice.updateMany({
      where: {
        id: { in: invoiceIds },
        state: "Sent",
        dueDate: { lt: now },
      },
      data: { state: "Overdue" },
    });
  }

  if (quoteIds.length > 0) {
    await prisma.quote.updateMany({
      where: {
        id: { in: quoteIds },
        state: "Sent",
        validUntil: { lt: now },
      },
      data: { state: "Expired" },
    });
  }
}

export async function checkAndUpdateAllDocumentStates(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.invoice.updateMany({
      where: { state: "Sent", dueDate: { lt: now } },
      data: { state: "Overdue" },
    }),
    prisma.quote.updateMany({
      where: { state: "Sent", validUntil: { lt: now } },
      data: { state: "Expired" },
    }),
  ]);
}
