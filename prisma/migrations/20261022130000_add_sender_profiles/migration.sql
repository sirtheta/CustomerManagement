-- CreateTable
CREATE TABLE "SenderProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "companyHolderName" TEXT,
    "companyEmail" TEXT,
    "companyPhone" TEXT,
    "logo" BLOB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "senderProfileId" INTEGER REFERENCES "SenderProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "senderProfileId" INTEGER REFERENCES "SenderProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
