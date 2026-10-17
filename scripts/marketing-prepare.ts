/**
 * Polishes the seeded marketing database so the screenshots show the newer
 * features at their best (templates on the subscriptions, open follow-up
 * tasks, a customer with a rich history). Run by marketing-screenshots.ts
 * after the server has seeded the throwaway DB; never touches the real one
 * (DATABASE_URL is set by the caller).
 *
 * Prints `RESULT {"customerId":<id>,"pdfInvoiceId":<id>}` — the customer to show on the
 * detail page and a regular numbered invoice (no credit note, no draft) for the PDF shot.
 */
import { PrismaClient, Unit } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const DAY_MS = 86_400_000;

async function main() {
  const dbPath = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbPath }) });

  const template = await prisma.invoiceTemplate.create({
    data: {
      name: "Hosting & Support",
      items: {
        create: [
          { name: "Webhosting", description: "Jahrespaket", unit: Unit.Package, unitPrice: 240, quantity: 1 },
          { name: "Support", description: "Inklusivstunden", unit: Unit.Hour, unitPrice: 120, quantity: 2 },
        ],
      },
    },
  });
  const subscriptions = await prisma.subscription.findMany({ orderBy: { nextInvoiceDate: "asc" } });
  for (const [i, sub] of subscriptions.entries()) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { templateId: template.id, autoSend: i % 3 === 0 },
    });
  }

  // The customer with the most invoices has the fullest history.
  const grouped = await prisma.invoice.groupBy({
    by: ["customerId"],
    where: { creditNoteForId: null },
    _count: { _all: true },
    orderBy: { _count: { customerId: "desc" } },
    take: 3,
  });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "Admin" } });
  const titles = [
    ["Offerte nachfassen", 3],
    ["Rückruf wegen Wartungsvertrag", 1],
    ["Jahresgespräch vereinbaren", 12],
  ] as const;
  for (const [i, g] of grouped.entries()) {
    const [title, days] = titles[i];
    await prisma.task.create({
      data: {
        customerId: g.customerId,
        title,
        dueDate: new Date(Date.now() + days * DAY_MS),
        assigneeId: admin.id,
      },
    });
  }

  const pdfInvoice = await prisma.invoice.findFirstOrThrow({
    where: { creditNoteForId: null, documentNumber: { not: null }, state: { in: ["Sent", "Paid"] } },
    orderBy: { id: "asc" },
  });

  console.log(`RESULT ${JSON.stringify({ customerId: grouped[0].customerId, pdfInvoiceId: pdfInvoice.id })}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
