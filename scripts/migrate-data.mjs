/**
 * One-time data migration: EF Core SQLite → Prisma SQLite
 *
 * Run: node scripts/migrate-data.mjs
 *
 * Conversions applied:
 *   - Integer enums  → string enums  (InvoiceState, QuoteState, Unit)
 *   - Empty strings  → null          (optional fields)
 *   - Duplicate CompanyInfo rows: only the active one (companyInformationId: 1)
 *   - ApplicationSettings: only the active one (applicationSettingsId: 11)
 */

import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.resolve(__dirname, "../../CustomerManagement.db");
const DST = path.resolve(__dirname, "../data/customermanagement.db");

// ── Enum maps (EF Core stores as integer) ────────────────────────────────────
const INVOICE_STATE = { 0: "Draft", 1: "Sent", 2: "Paid", 3: "Overdue", 4: "Canceled" };
const QUOTE_STATE   = { 0: "Draft", 1: "Sent", 2: "Accepted", 3: "Declined", 4: "Expired" };
const UNIT          = { 0: "Hour",  1: "Day",  2: "Piece",  3: "Package" };

// ── Helpers ──────────────────────────────────────────────────────────────────
const nullable = (v) => (v === "" || v === null || v === undefined ? null : v);
const toDate   = (v) => v ? new Date(v) : null;
const toBool   = (v) => v === 1 || v === true;

// ── Setup ────────────────────────────────────────────────────────────────────
const src = new Database(SRC, { readonly: true });
const adapter = new PrismaBetterSqlite3({ url: DST });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Source:", SRC);
  console.log("Target:", DST);
  console.log();

  // ── 0. Clear target ────────────────────────────────────────────────────────
  console.log("Clearing target tables...");
  await prisma.item.deleteMany();
  await prisma.document.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.service.deleteMany();
  await prisma.category.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.applicationSettings.deleteMany();
  await prisma.companyInformation.deleteMany();
  console.log("  Done.\n");

  // ── 1. CompanyInformation (only the active one: id=1) ─────────────────────
  const companyRow = src.prepare("SELECT * FROM CompanyInfo WHERE CompanyInformationId = 1").get();
  await prisma.companyInformation.create({
    data: {
      companyInformationId: companyRow.CompanyInformationId,
      companyName:          nullable(companyRow.CompanyName),
      companyHolderName:    nullable(companyRow.CompanyHolderName),
      companyAddress:       nullable(companyRow.CompanyAddress),
      companyZip:           nullable(companyRow.CompanyZip),
      companyCity:          nullable(companyRow.CompanyCity),
      companyEmail:         nullable(companyRow.CompanyEmail),
      companyPhone:         nullable(companyRow.CompanyPhone),
      companyIBAN:          nullable(companyRow.CompanyIBAN),
      companyLogo:          companyRow.CompanyLogo ?? null,
    },
  });
  console.log("CompanyInformation: 1 row migrated");

  // ── 2. ApplicationSettings (only active: id=11) ───────────────────────────
  const settingsRow = src.prepare("SELECT * FROM ApplicationSettings WHERE ApplicationSettingsId = 11").get();
  await prisma.applicationSettings.create({
    data: {
      applicationSettingsId:    settingsRow.ApplicationSettingsId,
      numberFormat:             settingsRow.NumberFormat,
      defaultPaymentTermDays:   settingsRow.DefaultPaymentTermDays,
      defaultQuoteValidityDays: settingsRow.DefaultQuoteValidityDays,
      invoiceNumberPrefix:      settingsRow.InvoiceNumberPrefix,
      quoteNumberPrefix:        settingsRow.QuoteNumberPrefix,
      defaultYearlyInvoice:     toBool(settingsRow.DefaultYearlyInvoice),
      backupPath:               nullable(settingsRow.BackupPath),
      lastBackupDate:           toDate(settingsRow.LastBackupDate),
      companyInformationId:     1,
    },
  });
  console.log("ApplicationSettings: 1 row migrated");

  // ── 3. Categories ─────────────────────────────────────────────────────────
  const categories = src.prepare("SELECT * FROM Categories ORDER BY CategoryId").all();
  for (const r of categories) {
    await prisma.category.create({
      data: {
        categoryId: r.CategoryId,
        name:       r.Name,
        isActive:   toBool(r.IsActive),
        colorHex:   nullable(r.ColorHex),
      },
    });
  }
  console.log(`Categories: ${categories.length} rows migrated`);

  // ── 4. Customers ──────────────────────────────────────────────────────────
  const customers = src.prepare("SELECT * FROM Customers ORDER BY CustomerId").all();
  for (const r of customers) {
    await prisma.customer.create({
      data: {
        customerId:              r.CustomerId,
        company:                 nullable(r.Company),
        contactPerson:           r.ContactPerson,
        address:                 r.Address,
        city:                    r.City,
        zipCode:                 r.ZipCode,
        email:                   r.Email,
        phone:                   nullable(r.Phone),
        yearlyInvoice:           toBool(r.YearlyInvoice),
        contactInsteadOfCompany: toBool(r.ContactInsteadOfCompany),
        nextInvoiceDate:         toDate(r.NextInvoiceDate),
      },
    });
  }
  console.log(`Customers: ${customers.length} rows migrated`);

  // ── 5. Services ───────────────────────────────────────────────────────────
  const services = src.prepare("SELECT * FROM Services ORDER BY Id").all();
  for (const r of services) {
    await prisma.service.create({
      data: {
        id:          r.Id,
        name:        r.Name,
        description: nullable(r.Description),
        unit:        UNIT[r.Unit],
        unitPrice:   r.UnitPrice,
        isActive:    toBool(r.IsActive),
        categoryId:  r.CategoryId ?? null,
      },
    });
  }
  console.log(`Services: ${services.length} rows migrated`);

  // ── 6. Invoices ───────────────────────────────────────────────────────────
  const invoices = src.prepare("SELECT * FROM Invoices ORDER BY Id").all();
  for (const r of invoices) {
    await prisma.invoice.create({
      data: {
        id:             r.Id,
        customerId:     r.CustomerId,
        documentNumber: r.DocumentNumber,
        customUserText: nullable(r.CustomUserText),
        date:           toDate(r.Date),
        version:        r.Version ?? 1,
        totalAmount:    r.TotalAmount,
        dueDate:        toDate(r.DueDate),
        state:          INVOICE_STATE[r.State],
      },
    });
  }
  console.log(`Invoices: ${invoices.length} rows migrated`);

  // ── 7. Quotes ─────────────────────────────────────────────────────────────
  const quotes = src.prepare("SELECT * FROM Quotes ORDER BY Id").all();
  for (const r of quotes) {
    await prisma.quote.create({
      data: {
        id:             r.Id,
        customerId:     r.CustomerId,
        documentNumber: r.DocumentNumber,
        customUserText: nullable(r.CustomUserText),
        date:           toDate(r.Date),
        version:        r.Version ?? 1,
        totalAmount:    r.TotalAmount,
        validUntil:     toDate(r.ValidUntil),
        state:          QUOTE_STATE[r.State],
      },
    });
  }
  console.log(`Quotes: ${quotes.length} rows migrated`);

  // ── 8. Items ──────────────────────────────────────────────────────────────
  const items = src.prepare("SELECT * FROM Items ORDER BY Id").all();
  for (const r of items) {
    await prisma.item.create({
      data: {
        id:          r.Id,
        name:        r.Name,
        description: nullable(r.Description),
        unit:        UNIT[r.Unit],
        unitPrice:   r.UnitPrice,
        quantity:    r.Quantity,
        totalAmount: r.TotalAmount,
        customText:  nullable(r.CustomText),
        categoryId:  r.CategoryId ?? null,
        invoiceId:   r.InvoiceId ?? null,
        quoteId:     r.QuoteId ?? null,
      },
    });
  }
  console.log(`Items: ${items.length} rows migrated`);

  // ── 9. Documents ──────────────────────────────────────────────────────────
  const documents = src.prepare("SELECT * FROM Documents ORDER BY DocumentId").all();
  for (const r of documents) {
    await prisma.document.create({
      data: {
        documentId: r.DocumentId,
        customerId: r.CustomerId,
        name:       r.Name,
        fileType:   r.FileType,
        uploadDate: toDate(r.UploadDate),
        content:    r.Content,
        note:       nullable(r.Note),
      },
    });
  }
  console.log(`Documents: ${documents.length} rows migrated`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== Migration complete ===");
  const counts = await Promise.all([
    prisma.companyInformation.count(),
    prisma.applicationSettings.count(),
    prisma.category.count(),
    prisma.customer.count(),
    prisma.service.count(),
    prisma.invoice.count(),
    prisma.quote.count(),
    prisma.item.count(),
    prisma.document.count(),
  ]);
  const labels = ["CompanyInformation","ApplicationSettings","Categories","Customers","Services","Invoices","Quotes","Items","Documents"];
  labels.forEach((l, i) => console.log(`  ${l}: ${counts[i]}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { src.close(); prisma.$disconnect(); });
