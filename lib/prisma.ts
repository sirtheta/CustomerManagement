import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

function getDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./data/customermanagement.db";
  return url.replace(/^file:/, "");
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: getDbPath() });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
