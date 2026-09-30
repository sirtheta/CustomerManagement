import { PrismaClient, InvoiceState, QuoteState, Unit, UserRole } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { loadEnvConfig } from "@next/env";
import { faker } from "@faker-js/faker";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

loadEnvConfig(process.cwd());

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./data/customermanagement.db";
  const dbPath = url.replace(/^file:/, "");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

const prisma = createClient();

const INVOICE_STATES = Object.values(InvoiceState);
const QUOTE_STATES = Object.values(QuoteState);
const UNITS = Object.values(Unit);

// Number of pending yearly-invoice mails to seed (see seedPendingYearlyInvoices)
const PENDING_YEARLY_COUNT = 3;

// Same defaults as lib/yearly-invoices.ts
const DEFAULT_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
const DEFAULT_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date}.\n\nZahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}";

function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function formatChDate(d: Date): string {
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function yyMM() {
  const now = new Date();
  return `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function swissZip() {
  return faker.number.int({ min: 1000, max: 9999 }).toString();
}

async function ensureUsers() {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const adminName = process.env.ADMIN_NAME ?? "Admin";
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  const totpSecret = process.env.TOTP_SECRET ?? null;

  let adminHash: string;
  if (adminPasswordHash) {
    adminHash = adminPasswordHash;
  } else {
    const plainPassword = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`No ADMIN_PASSWORD(_HASH) set — generated admin password: ${plainPassword}`);
    }
    adminHash = await hash(plainPassword, 10);
  }

  const testHash = await hash("admin123", 10);

  const users = [
    { email: adminEmail, name: adminName, passwordHash: adminHash, role: UserRole.Admin, totpSecret, totpEnabled: !!totpSecret },
    { email: "editor@example.com", name: "Editor", passwordHash: testHash, role: UserRole.Editor, totpSecret: null, totpEnabled: false },
    { email: "viewer@example.com", name: "Viewer", passwordHash: testHash, role: UserRole.Viewer, totpSecret: null, totpEnabled: false },
  ];

  for (const user of users) {
    await prisma.user.create({ data: { ...user, isActive: true } });
    console.log(`User created: ${user.email} (${user.role})`);
  }
}

async function main() {
  await ensureUsers();

  const existing = await prisma.customer.count();
  if (existing > 0) {
    console.log(`Database already contains ${existing} customers — skipping seed.`);
    return;
  }

  console.log("Seeding database...");

  // Categories — colors match the COLOR_PALETTE in the category management UI
  const categories = await Promise.all([
    prisma.category.create({ data: { name: "Websites", colorHex: "#3b82f6", isActive: true } }),
    prisma.category.create({ data: { name: "Hosting", colorHex: "#f97316", isActive: true } }),
    prisma.category.create({ data: { name: "Support", colorHex: "#22c55e", isActive: true } }),
  ]);

  // Expense categories (shared Category model, used by the accounting module)
  const expenseCategories = await Promise.all([
    prisma.category.create({ data: { name: "Miete", colorHex: "#8b5cf6", isActive: true } }),
    prisma.category.create({ data: { name: "Material", colorHex: "#ef4444", isActive: true } }),
    prisma.category.create({ data: { name: "Versicherung", colorHex: "#06b6d4", isActive: true } }),
    prisma.category.create({ data: { name: "Software & Abos", colorHex: "#64748b", isActive: true } }),
  ]);

  // Services (25 total)
  for (let i = 0; i < 25; i++) {
    const unitPrice = faker.number.float({ min: 50, max: 500, fractionDigits: 2 });
    await prisma.service.create({
      data: {
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        unit: faker.helpers.arrayElement(UNITS),
        unitPrice,
        isActive: faker.datatype.boolean({ probability: 0.8 }),
        categoryId: faker.helpers.arrayElement(categories).categoryId,
      },
    });
  }

  // Customers (50 total)
  const customers = [];
  for (let i = 0; i < 50; i++) {
    // The first few customers are guaranteed yearly-invoice customers so the
    // pending yearly mails below always have someone to belong to
    const forcedYearly = i < PENDING_YEARLY_COUNT;
    const customer = await prisma.customer.create({
      data: {
        company: faker.company.name(),
        contactPerson: faker.person.fullName(),
        street: faker.location.street(),
        houseNumber: faker.location.buildingNumber(),
        city: faker.location.city(),
        zipCode: swissZip(),
        email: faker.internet.email(),
        phone: faker.phone.number("+41 ## ### ## ##"),
        yearlyInvoice: forcedYearly || faker.datatype.boolean(),
        nextInvoiceDate: faker.date.future(),
      },
    });
    customers.push(customer);
  }

  // Invoices & Quotes per customer
  let invoiceCounter = 1;
  let quoteCounter = 1;
  const prefix = yyMM();

  for (const customer of customers) {
    const invoiceCount = faker.number.int({ min: 1, max: 5 });
    for (let i = 0; i < invoiceCount; i++) {
      const date = faker.date.past({ years: 1 });
      const dueDate = new Date(date.getTime() + 30 * 24 * 60 * 60 * 1000);
      const items = buildItems(categories);
      const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);
      const state = faker.helpers.arrayElement(INVOICE_STATES);
      // Paid invoices feed the cash-basis accounting module, so they need a paidDate
      const paidDate =
        state === InvoiceState.Paid || state === InvoiceState.PartiallyPaid
          ? faker.date.between({ from: date, to: new Date() })
          : null;
      const invoiceTotal = round2(totalAmount);
      // Payment is the source of truth: Paid invoices get one full payment, PartiallyPaid
      // invoices half of the total (and no paidDate, which is only set once fully paid)
      const payments =
        state === InvoiceState.Paid && paidDate
          ? [{ date: paidDate, amount: invoiceTotal, source: "manual" }]
          : state === InvoiceState.PartiallyPaid && paidDate
            ? [{ date: paidDate, amount: round2(invoiceTotal / 2), source: "manual" }]
            : [];
      // Non-draft invoices have been sent at least once and therefore carry a
      // number; drafts stay unnumbered (and don't consume the counter)
      const invoiceSent = state !== InvoiceState.Draft;
      const invoiceNumber = invoiceSent
        ? `I-${prefix}${String(invoiceCounter++).padStart(4, "0")}`
        : null;
      await prisma.invoice.create({
        data: {
          customerId: customer.customerId,
          documentNumber: invoiceNumber,
          customUserText: faker.lorem.paragraph(),
          date,
          dueDate,
          totalAmount: invoiceTotal,
          state,
          paidDate: state === InvoiceState.Paid ? paidDate : null,
          payments: payments.length > 0 ? { create: payments } : undefined,
          items: { create: items },
          sentLogs: invoiceNumber
            ? { create: buildSentLogs(invoiceNumber, "Rechnung", customer.email, date) }
            : undefined,
        },
      });
    }

    const quoteCount = faker.number.int({ min: 1, max: 5 });
    for (let i = 0; i < quoteCount; i++) {
      const date = faker.date.past({ years: 1 });
      const validUntil = new Date(
        date.getTime() + faker.number.int({ min: 30, max: 90 }) * 24 * 60 * 60 * 1000,
      );
      const items = buildItems(categories);
      const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);
      const quoteState = faker.helpers.arrayElement(QUOTE_STATES);
      // Non-draft quotes have been sent at least once and therefore carry a
      // number; drafts stay unnumbered (and don't consume the counter)
      const quoteSent = quoteState !== QuoteState.Draft;
      const quoteNumber = quoteSent
        ? `Q-${prefix}${String(quoteCounter++).padStart(4, "0")}`
        : null;
      await prisma.quote.create({
        data: {
          customerId: customer.customerId,
          documentNumber: quoteNumber,
          customUserText: faker.lorem.paragraph(),
          date,
          validUntil,
          version: faker.number.int({ min: 1, max: 5 }),
          totalAmount: round2(totalAmount),
          state: quoteState,
          items: { create: items },
          sentLogs: quoteNumber
            ? { create: buildSentLogs(quoteNumber, "Offerte", customer.email, date) }
            : undefined,
        },
      });
    }
  }

  // Expenses (spread over the past year) for the cash-basis accounting module
  const expenseDescriptions = [
    "Büromiete",
    "Materialeinkauf",
    "Haftpflichtversicherung",
    "Adobe Creative Cloud",
    "Server-Hosting",
    "Bürobedarf",
    "Weiterbildung",
    "Telefon & Internet",
    "Buchhaltungssoftware",
    "Reisekosten",
    "Marketingkampagne",
    "Bankgebühren",
  ];
  let expenseCount = 0;
  for (let i = 0; i < 60; i++) {
    await prisma.expense.create({
      data: {
        date: faker.date.past({ years: 1 }),
        description: faker.helpers.arrayElement(expenseDescriptions),
        amount: round2(faker.number.float({ min: 20, max: 2000, fractionDigits: 2 })),
        categoryId:
          faker.helpers.maybe(() => faker.helpers.arrayElement(expenseCategories).categoryId, {
            probability: 0.85,
          }) ?? null,
        notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) ?? null,
      },
    });
    expenseCount++;
  }

  // CompanyInformation
  const company = await prisma.companyInformation.create({
    data: {
      companyName: faker.company.name(),
      companyHolderName: faker.person.fullName(),
      companyStreet: faker.location.street(),
      companyHouseNumber: faker.location.buildingNumber(),
      companyCity: "Zürich",
      companyZip: "8000",
      companyEmail: faker.internet.email(),
      companyPhone: "+41 44 123 45 67",
      companyIBAN: "CH9600781622484102000",
    },
  });

  // ApplicationSettings
  await prisma.applicationSettings.create({
    data: {
      companyInformationId: company.companyInformationId,
    },
  });

  // Pending yearly invoices, exactly as checkYearlyInvoices leaves them
  const pendingYearly = await seedPendingYearlyInvoices(
    customers.slice(0, PENDING_YEARLY_COUNT),
    company.companyName,
    categories,
    prefix,
    invoiceCounter,
  );
  invoiceCounter = pendingYearly.invoiceCounter;

  console.log(
    `Seeding complete: ${categories.length + expenseCategories.length} categories, 25 services, 50 customers, ${invoiceCounter - 1} invoices, ${quoteCounter - 1} quotes, ${expenseCount} expenses, ${pendingYearly.count} pending yearly invoice mails.`,
  );
}

// Mirrors lib/yearly-invoices.ts: per due yearly customer a Draft invoice
// (documentNumber null, totalAmount 0, no items) plus a PendingEmail whose
// subject/body keep the raw {documentNumber} placeholder, and nextInvoiceDate
// advanced by one year. Each customer also gets a prior numbered, Paid invoice
// from a year ago so the history looks realistic.
async function seedPendingYearlyInvoices(
  yearlyCustomers: { customerId: number; contactPerson: string; email: string }[],
  companyName: string,
  categories: { categoryId: number }[],
  prefix: string,
  startCounter: number,
) {
  let invoiceCounter = startCounter;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const paymentDays = 30;
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + paymentDays);

  for (const [i, customer] of yearlyCustomers.entries()) {
    const priorDate = new Date(today);
    priorDate.setFullYear(priorDate.getFullYear() - 1);
    priorDate.setDate(priorDate.getDate() - i);
    const priorDue = new Date(priorDate);
    priorDue.setDate(priorDue.getDate() + paymentDays);
    const items = buildItems(categories);
    const priorTotal = round2(items.reduce((sum, item) => sum + item.totalAmount, 0));
    const priorNumber = `I-${prefix}${String(invoiceCounter++).padStart(4, "0")}`;
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: priorNumber,
        date: priorDate,
        dueDate: priorDue,
        totalAmount: priorTotal,
        state: InvoiceState.Paid,
        paidDate: priorDue,
        payments: { create: [{ date: priorDue, amount: priorTotal, source: "manual" }] },
        items: { create: items },
        sentLogs: { create: buildSentLogs(priorNumber, "Rechnung", customer.email, priorDate) },
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        date: today,
        dueDate,
        totalAmount: 0,
        state: InvoiceState.Draft,
      },
    });
    const vars = {
      documentNumber: "{documentNumber}",
      contactPerson: customer.contactPerson,
      companyName,
      totalAmount: new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" }).format(0),
      date: formatChDate(today),
      dueDate: formatChDate(dueDate),
      customUserText: "",
    };
    await prisma.pendingEmail.create({
      data: {
        invoiceId: invoice.id,
        to: customer.email,
        subject: resolveTemplate(DEFAULT_SUBJECT, vars),
        body: resolveTemplate(DEFAULT_BODY, vars),
      },
    });

    // The job was due today and advanced the date by one year
    const next = new Date(today);
    next.setFullYear(next.getFullYear() + 1);
    await prisma.customer.update({
      where: { customerId: customer.customerId },
      data: { nextInvoiceDate: next },
    });
  }

  return { count: yearlyCustomers.length, invoiceCounter };
}

// Generate 1–2 send-history entries (used for non-draft invoices/quotes).
function buildSentLogs(documentNumber: string, label: string, email: string, from: Date) {
  const count = faker.number.int({ min: 1, max: 2 });
  return Array.from({ length: count }, () => ({
    sentTo: email,
    subject: `${label} Nr. ${documentNumber}`,
    sentAt: faker.date.between({ from, to: new Date() }),
  }));
}

function buildItems(categories: { categoryId: number }[]) {
  const count = faker.number.int({ min: 1, max: 5 });
  return Array.from({ length: count }, () => {
    const unitPrice = faker.number.float({ min: 50, max: 500, fractionDigits: 2 });
    const quantity = faker.number.float({ min: 1, max: 10, fractionDigits: 1 });
    return {
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      unit: faker.helpers.arrayElement(UNITS),
      unitPrice,
      quantity,
      totalAmount: round2(unitPrice * quantity),
      categoryId: faker.helpers.arrayElement(categories).categoryId,
    };
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
