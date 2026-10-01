-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "paidDate" DATETIME;
ALTER TABLE "Expense" ADD COLUMN "supplier" TEXT;

-- CreateTable
CREATE TABLE "ExpenseReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "expenseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" BLOB NOT NULL,
    CONSTRAINT "ExpenseReceipt_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExpenseReceipt_expenseId_idx" ON "ExpenseReceipt"("expenseId");

-- CreateIndex
CREATE INDEX "Expense_paidDate_idx" ON "Expense"("paidDate");

-- Existing expenses were booked when paid, so they count as paid on their date
UPDATE "Expense" SET "paidDate" = "date";
