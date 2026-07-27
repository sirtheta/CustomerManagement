import type { PrismaClient } from "@prisma/client";

export async function checkOverdueInvoices(prisma: PrismaClient): Promise<void> {
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
