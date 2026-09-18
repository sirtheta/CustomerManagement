import type { PrismaClient } from "@prisma/client";

export async function checkOverdueInvoices(prisma: PrismaClient): Promise<void> {
  // Safety net for state changes that bypass the actions (direct DB edits,
  // older code paths): reminders of invoices that are no longer Overdue are
  // stale and must not linger in the Mahnungen list.
  await prisma.pendingReminder.deleteMany({
    where: { invoice: { state: { not: "Overdue" } } },
  });

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      state: "Overdue",
      pendingReminder: null,
    },
    select: { id: true },
  });

  if (overdueInvoices.length === 0) return;

  await prisma.pendingReminder.createMany({
    data: overdueInvoices.map((inv) => ({ invoiceId: inv.id })),
  });
}
