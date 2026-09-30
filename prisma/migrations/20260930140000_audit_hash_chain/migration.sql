-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_prevHash_key" ON "AuditLog"("prevHash");

