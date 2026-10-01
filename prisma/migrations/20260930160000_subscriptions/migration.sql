/*
  Warnings:

  - You are about to drop the column `nextInvoiceDate` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `yearlyInvoice` on the `Customer` table. All the data in the column will be lost.

*/
-- CreateTable
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

-- RedefineTables
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
INSERT INTO "new_Customer" ("addressNeedsReview", "archivedAt", "city", "company", "contactInsteadOfCompany", "contactPerson", "country", "customerId", "email", "houseNumber", "phone", "street", "zipCode") SELECT "addressNeedsReview", "archivedAt", "city", "company", "contactInsteadOfCompany", "contactPerson", "country", "customerId", "email", "houseNumber", "phone", "street", "zipCode" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_email_idx" ON "Customer"("email");
CREATE INDEX "Customer_archivedAt_idx" ON "Customer"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Subscription_nextInvoiceDate_idx" ON "Subscription"("nextInvoiceDate");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");
