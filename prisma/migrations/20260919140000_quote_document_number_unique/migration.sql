-- DropIndex
DROP INDEX "Quote_documentNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Quote_documentNumber_key" ON "Quote"("documentNumber");
