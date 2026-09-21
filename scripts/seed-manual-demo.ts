/**
 * Seeds a fixed, fictional demo instance used to capture the screenshots
 * embedded in public/benutzerhandbuch.html. Deterministic (no faker) so
 * re-running it reproduces the same customers, invoices and quotes and
 * keeps old and new screenshots visually consistent.
 *
 * Always run against a throwaway database, never the dev/prod one — this
 * script assumes an empty DB and does not check for existing rows (unlike
 * prisma/seed.ts). See scripts/manual-screenshots.ts, which wipes and
 * migrates data-manual/manual.db before calling this script.
 *
 * Demo accounts: admin@demo.local / editor@demo.local / viewer@demo.local,
 * password Demo1234!
 */
import { PrismaClient, InvoiceState, QuoteState, Unit, UserRole } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { loadEnvConfig } from "@next/env";
import { hash } from "bcryptjs";

loadEnvConfig(process.cwd());

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./data-manual/manual.db";
  const dbPath = url.replace(/^file:/, "");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

const prisma = createClient();

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  console.log("Seeding manual demo data...");

  const passwordHash = await hash("Demo1234!", 10);
  await prisma.user.createMany({
    data: [
      { email: "admin@demo.local", name: "Sandra Keller", passwordHash, role: UserRole.Admin, isActive: true },
      { email: "editor@demo.local", name: "Matteo Rossi", passwordHash, role: UserRole.Editor, isActive: true },
      { email: "viewer@demo.local", name: "Léa Fischer", passwordHash, role: UserRole.Viewer, isActive: true },
    ],
  });

  const serviceCategories = await Promise.all([
    prisma.category.create({ data: { name: "Websites", colorHex: "#3b82f6", isActive: true } }),
    prisma.category.create({ data: { name: "Hosting", colorHex: "#f97316", isActive: true } }),
    prisma.category.create({ data: { name: "Support", colorHex: "#22c55e", isActive: true } }),
  ]);
  const expenseCategories = await Promise.all([
    prisma.category.create({ data: { name: "Miete", colorHex: "#8b5cf6", isActive: true } }),
    prisma.category.create({ data: { name: "Material", colorHex: "#ef4444", isActive: true } }),
    prisma.category.create({ data: { name: "Versicherung", colorHex: "#06b6d4", isActive: true } }),
    prisma.category.create({ data: { name: "Software & Abos", colorHex: "#64748b", isActive: true } }),
  ]);
  const [websites, hosting, support] = serviceCategories;

  await prisma.service.createMany({
    data: [
      { name: "Website-Relaunch", description: "Konzept, Design und Umsetzung", unit: Unit.Package, unitPrice: 4800, isActive: true, categoryId: websites.categoryId },
      { name: "Hosting Starter", description: "Managed Hosting inkl. SSL", unit: Unit.Piece, unitPrice: 29, isActive: true, categoryId: hosting.categoryId },
      { name: "Hosting Business", description: "Managed Hosting mit täglichem Backup", unit: Unit.Piece, unitPrice: 79, isActive: true, categoryId: hosting.categoryId },
      { name: "Support-Stunden", description: "Ad-hoc Support und kleine Anpassungen", unit: Unit.Hour, unitPrice: 145, isActive: true, categoryId: support.categoryId },
      { name: "Wartungsvertrag", description: "Monatliche Wartung und Updates", unit: Unit.Piece, unitPrice: 190, isActive: true, categoryId: support.categoryId },
      { name: "SEO-Optimierung", description: "Technische und inhaltliche Suchmaschinenoptimierung", unit: Unit.Day, unitPrice: 950, isActive: false, categoryId: websites.categoryId },
    ],
  });

  const customerData = [
    { company: "Bergland Bäckerei AG", contactPerson: "Fritz Amrein", address: "Dorfstrasse 12", city: "Interlaken", zipCode: "3800", email: "info@bergland-baeckerei.ch", phone: "+41 33 822 14 50", yearlyInvoice: true, nextInvoiceDate: daysFromNow(45) },
    { company: "Zimmerei Wüthrich GmbH", contactPerson: "Karin Wüthrich", address: "Industriestrasse 8", city: "Thun", zipCode: "3600", email: "kontakt@zimmerei-wuethrich.ch", phone: "+41 33 437 60 10", yearlyInvoice: false, nextInvoiceDate: null },
    { company: "Café Lumière", contactPerson: "Aline Perret", address: "Rue du Marché 5", city: "Lausanne", zipCode: "1003", email: "aline@cafe-lumiere.ch", phone: "+41 21 311 22 44", yearlyInvoice: false, nextInvoiceDate: null },
    { company: "Optik Sonnenschein", contactPerson: "David Meyer", address: "Bahnhofstrasse 44", city: "Zürich", zipCode: "8001", email: "david.meyer@optik-sonnenschein.ch", phone: "+41 44 211 90 30", yearlyInvoice: true, nextInvoiceDate: daysFromNow(120) },
    { company: "Physiopraxis Bergmatt", contactPerson: "Nadja Steiner", address: "Bergmattweg 3", city: "Luzern", zipCode: "6003", email: "info@physio-bergmatt.ch", phone: "+41 41 240 55 12", yearlyInvoice: false, nextInvoiceDate: null },
    { company: null, contactPerson: "Beat Hofmann", address: "Rosenweg 9", city: "Basel", zipCode: "4056", email: "beat.hofmann@bluewin.ch", phone: "+41 61 333 77 89", yearlyInvoice: false, nextInvoiceDate: null, contactInsteadOfCompany: true },
    { company: "Garage Oberland AG", contactPerson: "Res Baumann", address: "Seestrasse 120", city: "Spiez", zipCode: "3700", email: "info@garage-oberland.ch", phone: "+41 33 654 22 11", yearlyInvoice: false, nextInvoiceDate: null },
    { company: "Confiserie Mathez", contactPerson: "Chantal Mathez", address: "Marktgasse 21", city: "Bern", zipCode: "3011", email: "chantal@confiserie-mathez.ch", phone: "+41 31 311 45 67", yearlyInvoice: true, nextInvoiceDate: daysFromNow(200) },
  ];
  const customers = await Promise.all(customerData.map((data) => prisma.customer.create({ data })));

  const yy = String(new Date().getFullYear()).slice(2);
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");
  const prefix = `${yy}${mm}`;

  function items(categoryId: number) {
    return [
      { name: "Website-Relaunch", unit: Unit.Package, unitPrice: 4800, quantity: 1, totalAmount: 4800, categoryId },
      { name: "Support-Stunden", unit: Unit.Hour, unitPrice: 145, quantity: 4, totalAmount: 580, categoryId },
    ];
  }

  const today = new Date();
  const pastDate = (daysAgo: number) => new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  const invoicePlans: { customer: (typeof customers)[number]; state: InvoiceState; daysAgo: number; dueInDays: number }[] = [
    { customer: customers[0], state: InvoiceState.Paid, daysAgo: 40, dueInDays: 30 },
    { customer: customers[1], state: InvoiceState.Sent, daysAgo: 5, dueInDays: 30 },
    { customer: customers[2], state: InvoiceState.Overdue, daysAgo: 60, dueInDays: 30 },
    { customer: customers[3], state: InvoiceState.Draft, daysAgo: 0, dueInDays: 30 },
    { customer: customers[4], state: InvoiceState.Canceled, daysAgo: 20, dueInDays: 30 },
    { customer: customers[6], state: InvoiceState.Paid, daysAgo: 90, dueInDays: 30 },
    { customer: customers[7], state: InvoiceState.Sent, daysAgo: 2, dueInDays: 30 },
  ];

  let invoiceCounter = 1;
  for (const plan of invoicePlans) {
    const date = pastDate(plan.daysAgo);
    const dueDate = new Date(date.getTime() + plan.dueInDays * 24 * 60 * 60 * 1000);
    const documentNumber = `I-${prefix}${String(invoiceCounter++).padStart(4, "0")}`;
    const invoiceItems = items(websites.categoryId);
    const totalAmount = invoiceItems.reduce((sum, i) => sum + i.totalAmount, 0);
    const paidDate = plan.state === InvoiceState.Paid ? new Date(date.getTime() + 12 * 24 * 60 * 60 * 1000) : null;

    const invoice = await prisma.invoice.create({
      data: {
        customerId: plan.customer.customerId,
        documentNumber,
        date,
        dueDate,
        totalAmount,
        state: plan.state,
        paidDate,
        items: { create: invoiceItems },
        sentLogs:
          plan.state !== InvoiceState.Draft
            ? { create: [{ sentTo: plan.customer.email, subject: `Rechnung Nr. ${documentNumber}`, sentAt: date }] }
            : undefined,
      },
    });

    // One Sent invoice with a queued email, one Overdue invoice with a
    // pending reminder — so the "Ausstehende E-Mails" and "Ausstehende
    // Mahnungen" pages have something to show.
    if (plan.state === InvoiceState.Sent && plan.daysAgo <= 3) {
      await prisma.pendingEmail.create({
        data: {
          invoiceId: invoice.id,
          to: plan.customer.email,
          subject: `Rechnung Nr. ${documentNumber}`,
          body: `Guten Tag,\n\nanbei die Rechnung Nr. ${documentNumber}.\n\nFreundliche Grüsse`,
        },
      });
    }
    if (plan.state === InvoiceState.Overdue) {
      await prisma.pendingReminder.create({
        data: { invoiceId: invoice.id, reminderLevel: 1 },
      });
    }
  }

  const quotePlans: { customer: (typeof customers)[number]; state: QuoteState; daysAgo: number; validForDays: number }[] = [
    { customer: customers[1], state: QuoteState.Accepted, daysAgo: 30, validForDays: 60 },
    { customer: customers[2], state: QuoteState.Sent, daysAgo: 3, validForDays: 45 },
    { customer: customers[4], state: QuoteState.Draft, daysAgo: 0, validForDays: 30 },
    { customer: customers[5], state: QuoteState.Declined, daysAgo: 25, validForDays: 30 },
    { customer: customers[6], state: QuoteState.Expired, daysAgo: 120, validForDays: 30 },
  ];

  let quoteCounter = 1;
  for (const plan of quotePlans) {
    const date = pastDate(plan.daysAgo);
    const validUntil = new Date(date.getTime() + plan.validForDays * 24 * 60 * 60 * 1000);
    const documentNumber = `Q-${prefix}${String(quoteCounter++).padStart(4, "0")}`;
    const quoteItems = items(support.categoryId);
    const totalAmount = quoteItems.reduce((sum, i) => sum + i.totalAmount, 0);

    await prisma.quote.create({
      data: {
        customerId: plan.customer.customerId,
        documentNumber,
        date,
        validUntil,
        totalAmount,
        state: plan.state,
        items: { create: quoteItems },
        sentLogs:
          plan.state !== QuoteState.Draft
            ? { create: [{ sentTo: plan.customer.email, subject: `Offerte Nr. ${documentNumber}`, sentAt: date }] }
            : undefined,
      },
    });
  }

  const expenseRows: { description: string; amount: number; categoryId: number; daysAgo: number }[] = [
    { description: "Büromiete", amount: 1450, categoryId: expenseCategories[0].categoryId, daysAgo: 15 },
    { description: "Büromiete", amount: 1450, categoryId: expenseCategories[0].categoryId, daysAgo: 45 },
    { description: "Materialeinkauf Webshop", amount: 320.5, categoryId: expenseCategories[1].categoryId, daysAgo: 8 },
    { description: "Haftpflichtversicherung", amount: 640, categoryId: expenseCategories[2].categoryId, daysAgo: 200 },
    { description: "Adobe Creative Cloud", amount: 59.9, categoryId: expenseCategories[3].categoryId, daysAgo: 10 },
    { description: "Server-Hosting", amount: 89, categoryId: expenseCategories[3].categoryId, daysAgo: 12 },
    { description: "Bürobedarf", amount: 142.3, categoryId: expenseCategories[1].categoryId, daysAgo: 33 },
    { description: "Buchhaltungssoftware", amount: 49, categoryId: expenseCategories[3].categoryId, daysAgo: 40 },
    { description: "Telefon & Internet", amount: 98, categoryId: expenseCategories[3].categoryId, daysAgo: 60 },
    { description: "Weiterbildung", amount: 480, categoryId: null, daysAgo: 70 },
    { description: "Marketingkampagne", amount: 620, categoryId: null, daysAgo: 90 },
    { description: "Bankgebühren", amount: 24.5, categoryId: expenseCategories[3].categoryId, daysAgo: 5 },
  ];
  await prisma.expense.createMany({
    data: expenseRows.map((row) => ({
      date: pastDate(row.daysAgo),
      description: row.description,
      amount: row.amount,
      categoryId: row.categoryId,
    })),
  });

  const company = await prisma.companyInformation.create({
    data: {
      companyName: "Muster Digitalwerkstatt GmbH",
      companyHolderName: "Sandra Keller",
      companyAddress: "Handwerkerstrasse 4",
      companyCity: "Zürich",
      companyZip: "8005",
      companyEmail: "info@muster-digitalwerkstatt.ch",
      companyPhone: "+41 44 500 12 34",
      companyIBAN: "CH9300762011623852957",
    },
  });
  await prisma.applicationSettings.create({
    data: { companyInformationId: company.companyInformationId },
  });

  console.log(
    `Seed complete: 3 users, ${customers.length} customers, ${invoiceCounter - 1} invoices, ${quoteCounter - 1} quotes, ${expenseRows.length} expenses.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
