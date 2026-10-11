-- CreateTable
CREATE TABLE "WorkEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "serviceId" INTEGER,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "note" TEXT,
    "invoiceId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApplicationSettings" (
    "applicationSettingsId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "numberFormat" TEXT NOT NULL DEFAULT 'de-CH',
    "defaultPaymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "defaultQuoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "invoiceNumberPrefix" TEXT NOT NULL DEFAULT 'I-',
    "quoteNumberPrefix" TEXT NOT NULL DEFAULT 'Q-',
    "useHolderNameOnQR" BOOLEAN NOT NULL DEFAULT false,
    "roundTotalTo5Rappen" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "smtpFromName" TEXT,
    "smtpFromAddress" TEXT,
    "emailSubjectTemplate" TEXT,
    "emailBodyTemplate" TEXT,
    "reminderCooldownDays" INTEGER NOT NULL DEFAULT 14,
    "reminderFeeLevel2Rappen" INTEGER NOT NULL DEFAULT 0,
    "reminderFeeLevel3Rappen" INTEGER NOT NULL DEFAULT 0,
    "reminderFeeLevel4Rappen" INTEGER NOT NULL DEFAULT 0,
    "reminderInterestPercent" DECIMAL NOT NULL DEFAULT 0,
    "notifyOverdueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyPendingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmailAddress" TEXT,
    "notifyTelegramBotToken" TEXT,
    "notifyTelegramChatId" TEXT,
    "notifyRepeatIntervalDays" INTEGER,
    "moduleTasks" BOOLEAN NOT NULL DEFAULT true,
    "moduleSubscriptions" BOOLEAN NOT NULL DEFAULT true,
    "moduleQuotes" BOOLEAN NOT NULL DEFAULT true,
    "moduleReminders" BOOLEAN NOT NULL DEFAULT true,
    "moduleBankImport" BOOLEAN NOT NULL DEFAULT true,
    "moduleAccounting" BOOLEAN NOT NULL DEFAULT true,
    "moduleAnalytics" BOOLEAN NOT NULL DEFAULT true,
    "moduleTimeTracking" BOOLEAN NOT NULL DEFAULT true,
    "pdfTheme" JSONB,
    "companyInformationId" INTEGER NOT NULL,
    CONSTRAINT "ApplicationSettings_companyInformationId_fkey" FOREIGN KEY ("companyInformationId") REFERENCES "CompanyInformation" ("companyInformationId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ApplicationSettings" ("applicationSettingsId", "companyInformationId", "defaultPaymentTermDays", "defaultQuoteValidityDays", "emailBodyTemplate", "emailSubjectTemplate", "invoiceNumberPrefix", "moduleAccounting", "moduleAnalytics", "moduleBankImport", "moduleQuotes", "moduleReminders", "moduleSubscriptions", "moduleTasks", "notifyEmailAddress", "notifyOverdueEnabled", "notifyPendingEnabled", "notifyRepeatIntervalDays", "notifyTelegramBotToken", "notifyTelegramChatId", "numberFormat", "pdfTheme", "quoteNumberPrefix", "reminderCooldownDays", "reminderFeeLevel2Rappen", "reminderFeeLevel3Rappen", "reminderFeeLevel4Rappen", "reminderInterestPercent", "roundTotalTo5Rappen", "smtpFromAddress", "smtpFromName", "smtpHost", "smtpPassword", "smtpPort", "smtpUser", "useHolderNameOnQR") SELECT "applicationSettingsId", "companyInformationId", "defaultPaymentTermDays", "defaultQuoteValidityDays", "emailBodyTemplate", "emailSubjectTemplate", "invoiceNumberPrefix", "moduleAccounting", "moduleAnalytics", "moduleBankImport", "moduleQuotes", "moduleReminders", "moduleSubscriptions", "moduleTasks", "notifyEmailAddress", "notifyOverdueEnabled", "notifyPendingEnabled", "notifyRepeatIntervalDays", "notifyTelegramBotToken", "notifyTelegramChatId", "numberFormat", "pdfTheme", "quoteNumberPrefix", "reminderCooldownDays", "reminderFeeLevel2Rappen", "reminderFeeLevel3Rappen", "reminderFeeLevel4Rappen", "reminderInterestPercent", "roundTotalTo5Rappen", "smtpFromAddress", "smtpFromName", "smtpHost", "smtpPassword", "smtpPort", "smtpUser", "useHolderNameOnQR" FROM "ApplicationSettings";
DROP TABLE "ApplicationSettings";
ALTER TABLE "new_ApplicationSettings" RENAME TO "ApplicationSettings";
CREATE UNIQUE INDEX "ApplicationSettings_companyInformationId_key" ON "ApplicationSettings"("companyInformationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorkEntry_customerId_idx" ON "WorkEntry"("customerId");

-- CreateIndex
CREATE INDEX "WorkEntry_date_idx" ON "WorkEntry"("date");

-- CreateIndex
CREATE INDEX "WorkEntry_invoiceId_idx" ON "WorkEntry"("invoiceId");
