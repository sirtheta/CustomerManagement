-- Dedupe before adding the unique index: legacy databases created before
-- document numbers were generated inside the insert transaction may hold
-- colliding quote numbers. The oldest row keeps its number; later
-- duplicates get "-<id>" appended so the index below can be created.
UPDATE "Quote"
SET "documentNumber" = "documentNumber" || '-' || "id"
WHERE "id" NOT IN (SELECT MIN("id") FROM "Quote" GROUP BY "documentNumber");

-- DropIndex
DROP INDEX "Quote_documentNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Quote_documentNumber_key" ON "Quote"("documentNumber");

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "discountPercent" DECIMAL NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");
