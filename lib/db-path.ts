/**
 * SQLite database file path from DATABASE_URL. Deliberately dependency-free:
 * lib/log-capture.ts (which must not construct the pino logger) and
 * lib/backup.ts (which must not instantiate the Prisma client at import time)
 * both need it without pulling in lib/prisma.
 */
export function getDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/customermanagement.db";
  return url.replace(/^file:/, "");
}
