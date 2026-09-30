-- CreateTable
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

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_date_idx" ON "Payment"("date");

-- Backfill: one payment per already paid invoice
INSERT INTO "Payment" ("invoiceId", "date", "amount", "source")
SELECT "id", COALESCE("paidDate", "date"), "totalAmount", 'migration'
FROM "Invoice"
WHERE "state" = 'Paid' AND "totalAmount" > 0;
