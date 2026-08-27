-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "customUserText" TEXT,
    "date" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DECIMAL NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "discountPercent" DECIMAL NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'Draft',
    "paidDate" DATETIME,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("customUserText", "customerId", "date", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version") SELECT "customUserText", "customerId", "date", "documentNumber", "dueDate", "id", "paidDate", "state", "totalAmount", "version" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_date_idx" ON "Invoice"("date");
CREATE INDEX "Invoice_state_idx" ON "Invoice"("state");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "Invoice_paidDate_idx" ON "Invoice"("paidDate");
CREATE UNIQUE INDEX "Invoice_documentNumber_key" ON "Invoice"("documentNumber");
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "discountPercent" DECIMAL NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL NOT NULL,
    "customText" TEXT,
    "categoryId" INTEGER,
    "invoiceId" INTEGER,
    "quoteId" INTEGER,
    CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("categoryId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("categoryId", "customText", "description", "id", "invoiceId", "name", "quantity", "quoteId", "totalAmount", "unit", "unitPrice") SELECT "categoryId", "customText", "description", "id", "invoiceId", "name", "quantity", "quoteId", "totalAmount", "unit", "unitPrice" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE INDEX "Item_invoiceId_idx" ON "Item"("invoiceId");
CREATE INDEX "Item_quoteId_idx" ON "Item"("quoteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
