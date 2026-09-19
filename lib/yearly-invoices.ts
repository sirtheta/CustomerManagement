import type { Prisma, PrismaClient } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";

async function generateInvoiceNumberTx(
  tx: Prisma.TransactionClient,
  prefix: string
): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const existingInvoices = await tx.invoice.findMany({
    where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
    select: { documentNumber: true },
  });
  let maxSeq = 0;
  for (const inv of existingInvoices) {
    const seq = parseInt(inv.documentNumber.slice(-4), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${yy}${mm}${String(maxSeq + 1).padStart(4, "0")}`;
}

const DEFAULT_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
const DEFAULT_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date}.\n\nZahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}";

function resolve(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export async function checkYearlyInvoices(prisma: PrismaClient): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [settings, dueCustomers] = await Promise.all([
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
    prisma.customer.findMany({
      where: {
        yearlyInvoice: true,
        nextInvoiceDate: { lte: today },
      },
    }),
  ]);

  if (dueCustomers.length === 0) return;

  const companyName = settings?.companyInfo.companyName ?? "";
  const subjectTpl = settings?.emailSubjectTemplate || DEFAULT_SUBJECT;
  const bodyTpl = settings?.emailBodyTemplate || DEFAULT_BODY;
  const paymentDays = settings?.defaultPaymentTermDays ?? 30;
  const prefix = settings?.invoiceNumberPrefix ?? "R-";

  for (const customer of dueCustomers) {
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    // Invoice creation, PendingEmail creation and the nextInvoiceDate advance
    // must succeed or fail together: a crash between separate awaits used to
    // leave nextInvoiceDate un-advanced, so the next cron run would bill the
    // same customer again for the same period.
    await prisma.$transaction(async (tx) => {
      const documentNumber = await generateInvoiceNumberTx(tx, prefix);

      const invoice = await tx.invoice.create({
        data: {
          customerId: customer.customerId,
          documentNumber,
          date: today,
          dueDate,
          totalAmount: 0,
          state: "Draft",
        },
      });

      const vars = {
        documentNumber,
        contactPerson: customer.contactPerson,
        companyName,
        totalAmount: formatCurrency(0),
        date: formatDate(today),
        dueDate: formatDate(dueDate),
        customUserText: "",
      };

      await tx.pendingEmail.create({
        data: {
          invoiceId: invoice.id,
          to: customer.email,
          subject: resolve(subjectTpl, vars),
          body: resolve(bodyTpl, vars),
        },
      });

      // Advance nextInvoiceDate by 1 year
      const next = new Date(customer.nextInvoiceDate!);
      next.setFullYear(next.getFullYear() + 1);
      await tx.customer.update({
        where: { customerId: customer.customerId },
        data: { nextInvoiceDate: next },
      });
    });
  }
}
