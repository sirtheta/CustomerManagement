-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "topic" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "topic" TEXT;

-- AlterTable
ALTER TABLE "InvoiceTemplate" ADD COLUMN "topic" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "topic" TEXT;
