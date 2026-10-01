-- Schema changes since release 1.5.0, combined into one migration:
--   structured addresses, nullable document numbers, payments, invoice locking
--   and credit notes, audit hash chain, sent documents, subscriptions, bank
--   transactions and expense receipts, dunning fees and interest.
-- None of the replaced migrations was ever released, so databases that ran
-- them during development have to be recreated (or reset to 1.5.0).

-- ── Structured addresses ────────────────────────────────────────────────
-- Swiss QR-bill (Implementation Guidelines 2.x) only accepts structured
-- addresses: street and building number in separate fields, plus a country.
-- Existing free-text addresses are split heuristically: the last
-- whitespace-separated token becomes the house number when it starts with a
-- digit ("Musterstrasse 12a" -> "Musterstrasse" / "12a"). Anything else stays
-- entirely in the street field. Every migrated row is flagged for review so
-- the user can confirm the split in the UI (saving the record clears the flag).

-- Customer
ALTER TABLE "Customer" RENAME COLUMN "address" TO "street";
ALTER TABLE "Customer" ADD COLUMN "houseNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'CH';
ALTER TABLE "Customer" ADD COLUMN "addressNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "_sp" INTEGER;

UPDATE "Customer" SET "street" = trim("street");

-- Position of the last space (0 when there is none).
UPDATE "Customer" SET "_sp" = (
  WITH RECURSIVE r(i) AS (
    SELECT length("Customer"."street")
    UNION ALL
    SELECT i - 1 FROM r WHERE i > 0 AND substr("Customer"."street", i, 1) <> ' '
  )
  SELECT min(i) FROM r
);

UPDATE "Customer" SET
  "houseNumber" = substr("street", "_sp" + 1),
  "street" = trim(substr("street", 1, "_sp"))
WHERE "_sp" > 1 AND substr("street", "_sp" + 1) GLOB '[0-9]*';

UPDATE "Customer" SET "addressNeedsReview" = true WHERE "street" <> '';
ALTER TABLE "Customer" DROP COLUMN "_sp";

-- CompanyInformation
ALTER TABLE "CompanyInformation" RENAME COLUMN "companyAddress" TO "companyStreet";
ALTER TABLE "CompanyInformation" ADD COLUMN "companyHouseNumber" TEXT;
ALTER TABLE "CompanyInformation" ADD COLUMN "companyCountry" TEXT NOT NULL DEFAULT 'CH';
ALTER TABLE "CompanyInformation" ADD COLUMN "companyAddressNeedsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyInformation" ADD COLUMN "_sp" INTEGER;

UPDATE "CompanyInformation" SET "companyStreet" = trim("companyStreet")
WHERE "companyStreet" IS NOT NULL;

UPDATE "CompanyInformation" SET "_sp" = (
  WITH RECURSIVE r(i) AS (
    SELECT length("CompanyInformation"."companyStreet")
    UNION ALL
    SELECT i - 1 FROM r
    WHERE i > 0 AND substr("CompanyInformation"."companyStreet", i, 1) <> ' '
  )
  SELECT min(i) FROM r
)
WHERE "companyStreet" IS NOT NULL;

UPDATE "CompanyInformation" SET
  "companyHouseNumber" = substr("companyStreet", "_sp" + 1),
  "companyStreet" = trim(substr("companyStreet", 1, "_sp"))
WHERE "_sp" > 1 AND substr("companyStreet", "_sp" + 1) GLOB '[0-9]*';

UPDATE "CompanyInformation" SET "companyAddressNeedsReview" = true
WHERE "companyStreet" IS NOT NULL AND "companyStreet" <> '';
ALTER TABLE "CompanyInformation" DROP COLUMN "_sp";

-- ── Subscriptions ───────────────────────────────────────────────────────
-- Replaces Customer.yearlyInvoice / Customer.nextInvoiceDate (dropped in the
-- Customer redefinition below).
CREATE TABLE "Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "interval" TEXT NOT NULL,
    "nextInvoiceDate" DATETIME NOT NULL,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subscription_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InvoiceTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Existing yearly customers become one Yearly subscription each (no template,
-- manual approval), keeping their planned date.
INSERT INTO "Subscription" ("customerId", "interval", "nextInvoiceDate", "autoSend", "active")
SELECT "customerId", 'Yearly', "nextInvoiceDate", false, true
FROM "Customer"
WHERE "yearlyInvoice" = true AND "nextInvoiceDate" IS NOT NULL;

CREATE INDEX "Subscription_nextInvoiceDate_idx" ON "Subscription"("nextInvoiceDate");
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

-- ── Customer / Invoice / Quote ──────────────────────────────────────────
-- Customer: archivedAt added, yearlyInvoice and nextInvoiceDate dropped.
-- Invoice: documentNumber nullable (drafts), creditNoteForId added, customer
--   relation RESTRICT instead of CASCADE.
-- Quote: documentNumber nullable (drafts).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "customerId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company" TEXT,
    "contactPerson" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "houseNumber" TEXT,
    "city" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'CH',
    "addressNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "contactInsteadOfCompany" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME
);
INSERT INTO "new_Customer" ("addressNeedsReview", "city", "company", "contactInsteadOfCompany", "contactPerson", "country", "customerId", "email", "houseNumber", "phone", "street", "zipCode") SELECT "addressNeedsReview", "city", "company", "contactInsteadOfCompany", "contactPerson", "country", "customerId", "email", "houseNumber", "phone", "street", "zipCode" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_email_idx" ON "Customer"("email");
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");

CREATE TABLE "new_Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "documentNumber" TEXT,
    "customUserText" TEXT,
    "date" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DECIMAL NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "discountPercent" DECIMAL NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'Draft',
    "paidDate" DATETIME,
    "creditNoteForId" INTEGER,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_creditNoteForId_fkey" FOREIGN KEY ("creditNoteForId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("customUserText", "customerId", "date", "discountPercent", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version") SELECT "customUserText", "customerId", "date", "discountPercent", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_date_idx" ON "Invoice"("date");
CREATE INDEX "Invoice_state_idx" ON "Invoice"("state");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "Invoice_paidDate_idx" ON "Invoice"("paidDate");
CREATE INDEX "Invoice_creditNoteForId_idx" ON "Invoice"("creditNoteForId");
CREATE UNIQUE INDEX "Invoice_documentNumber_key" ON "Invoice"("documentNumber");

CREATE TABLE "new_Quote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "documentNumber" TEXT,
    "customUserText" TEXT,
    "date" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DECIMAL NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "discountPercent" DECIMAL NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'Draft',
    CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("customUserText", "customerId", "date", "discountPercent", "documentNumber", "id", "state", "totalAmount", "validUntil", "version") SELECT "customUserText", "customerId", "date", "discountPercent", "documentNumber", "id", "state", "totalAmount", "validUntil", "version" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX "Quote_date_idx" ON "Quote"("date");
CREATE INDEX "Quote_state_idx" ON "Quote"("state");
CREATE INDEX "Quote_validUntil_idx" ON "Quote"("validUntil");
CREATE UNIQUE INDEX "Quote_documentNumber_key" ON "Quote"("documentNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- ── Payments ────────────────────────────────────────────────────────────
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "bankReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_date_idx" ON "Payment"("date");

-- Backfill: one payment per already paid invoice
INSERT INTO "Payment" ("invoiceId", "date", "amount", "source")
SELECT "id", COALESCE("paidDate", "date"), "totalAmount", 'migration'
FROM "Invoice"
WHERE "state" = 'Paid' AND "totalAmount" > 0;

-- ── Audit hash chain ────────────────────────────────────────────────────
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
CREATE UNIQUE INDEX "AuditLog_prevHash_key" ON "AuditLog"("prevHash");

-- ── Sent documents (PDF archive) ────────────────────────────────────────
CREATE TABLE "SentDocument" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reminderLevel" INTEGER,
    "documentNumber" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sentTo" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,
    CONSTRAINT "SentDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SentDocument_invoiceId_idx" ON "SentDocument"("invoiceId");

-- ── Expenses: supplier, due/paid date, receipts ─────────────────────────
ALTER TABLE "Expense" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "paidDate" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "supplier" TEXT;

CREATE TABLE "ExpenseReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "expenseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" BLOB NOT NULL,
    CONSTRAINT "ExpenseReceipt_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ExpenseReceipt_expenseId_idx" ON "ExpenseReceipt"("expenseId");
CREATE INDEX "Expense_paidDate_idx" ON "Expense"("paidDate");

-- Existing expenses were booked when paid, so they count as paid on their date
UPDATE "Expense" SET "paidDate" = "date";

-- ── Bank import (CAMT.053) ──────────────────────────────────────────────
CREATE TABLE "BankStatementImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT NOT NULL,
    "iban" TEXT,
    "currency" TEXT,
    "periodFrom" TEXT,
    "periodTo" TEXT,
    "openingBalanceRappen" INTEGER,
    "closingBalanceRappen" INTEGER,
    "balanceWarning" TEXT,
    "importedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "BankTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "importId" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amountRappen" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "bankReference" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "paymentId" INTEGER,
    "expenseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BankTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BankTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BankStatementImport_createdAt_idx" ON "BankStatementImport"("createdAt");
CREATE INDEX "BankStatementImport_iban_periodTo_idx" ON "BankStatementImport"("iban", "periodTo");
CREATE UNIQUE INDEX "BankTransaction_fingerprint_key" ON "BankTransaction"("fingerprint");
CREATE UNIQUE INDEX "BankTransaction_paymentId_key" ON "BankTransaction"("paymentId");
CREATE UNIQUE INDEX "BankTransaction_expenseId_key" ON "BankTransaction"("expenseId");
CREATE INDEX "BankTransaction_importId_idx" ON "BankTransaction"("importId");
CREATE INDEX "BankTransaction_date_idx" ON "BankTransaction"("date");

-- F8: dunning fees, interest and the amounts printed on a Mahnbeleg
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel2Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel3Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel4Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderInterestPercent" DECIMAL NOT NULL DEFAULT 0;

ALTER TABLE "SentDocument" ADD COLUMN "dunningDate" DATETIME;
ALTER TABLE "SentDocument" ADD COLUMN "feeRappen" INTEGER;
ALTER TABLE "SentDocument" ADD COLUMN "interestPercent" DECIMAL;
ALTER TABLE "SentDocument" ADD COLUMN "interestRappen" INTEGER;
ALTER TABLE "SentDocument" ADD COLUMN "openRappen" INTEGER;

-- The old code raised the level without a cap; level 4 is now the last one.
UPDATE "PendingReminder" SET "reminderLevel" = 4 WHERE "reminderLevel" > 4;

-- ── Extended customer model (F10) ───────────────────────────────────────
ALTER TABLE "Customer" ADD COLUMN "customerNumber" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "uid" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingStreet" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingHouseNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingZipCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingCity" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingCountry" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "Customer" ADD COLUMN "paymentTermDays" INTEGER;

-- Existing customers are numbered from 1001 in the order of their id; the
-- unique index is only created afterwards.
UPDATE "Customer" SET "customerNumber" = 1000 + (
  SELECT COUNT(*) FROM "Customer" AS c2 WHERE c2."customerId" <= "Customer"."customerId"
);
CREATE UNIQUE INDEX "Customer_customerNumber_key" ON "Customer"("customerNumber");

CREATE TABLE "CustomerContact" (
    "contactId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");
