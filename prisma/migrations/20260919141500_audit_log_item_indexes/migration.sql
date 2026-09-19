-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "discountPercent" DECIMAL NOT NULL DEFAULT 0;
