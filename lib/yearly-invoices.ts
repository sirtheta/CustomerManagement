import type { PrismaClient } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";

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
    // Idempotency: skip if already has a pending email for this customer
    const existing = await prisma.pendingEmail.findFirst({
      where: { invoice: { customerId: customer.customerId } },
    });
    if (existing) continue;

    // Generate invoice number
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const existing_invoices = await prisma.invoice.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    let maxSeq = 0;
    for (const inv of existing_invoices) {
      const seq = parseInt(inv.documentNumber.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    const documentNumber = `${prefix}${yy}${mm}${String(maxSeq + 1).padStart(4, "0")}`;

    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const invoice = await prisma.invoice.create({
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

    await prisma.pendingEmail.create({
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
    await prisma.customer.update({
      where: { customerId: customer.customerId },
      data: { nextInvoiceDate: next },
    });
  }
}
