-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "sourceQuoteId" INTEGER,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_creditNoteForId_fkey" FOREIGN KEY ("creditNoteForId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("creditNoteForId", "customUserText", "customerId", "date", "discountPercent", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version") SELECT "creditNoteForId", "customUserText", "customerId", "date", "discountPercent", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_date_idx" ON "Invoice"("date");
CREATE INDEX "Invoice_state_idx" ON "Invoice"("state");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "Invoice_paidDate_idx" ON "Invoice"("paidDate");
CREATE INDEX "Invoice_creditNoteForId_idx" ON "Invoice"("creditNoteForId");
CREATE INDEX "Invoice_sourceQuoteId_idx" ON "Invoice"("sourceQuoteId");
CREATE UNIQUE INDEX "Invoice_documentNumber_key" ON "Invoice"("documentNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
