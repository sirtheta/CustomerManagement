-- DropIndex
DROP INDEX "Invoice_documentNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_documentNumber_key" ON "Invoice"("documentNumber");
