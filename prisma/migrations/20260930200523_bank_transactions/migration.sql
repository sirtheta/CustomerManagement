-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "BankStatementImport_createdAt_idx" ON "BankStatementImport"("createdAt");

-- CreateIndex
CREATE INDEX "BankStatementImport_iban_periodTo_idx" ON "BankStatementImport"("iban", "periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_fingerprint_key" ON "BankTransaction"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_paymentId_key" ON "BankTransaction"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_expenseId_key" ON "BankTransaction"("expenseId");

-- CreateIndex
CREATE INDEX "BankTransaction_importId_idx" ON "BankTransaction"("importId");

-- CreateIndex
CREATE INDEX "BankTransaction_date_idx" ON "BankTransaction"("date");
