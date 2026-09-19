import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type DbClient = typeof prisma | Prisma.TransactionClient;

// Deliberately no "use server": that directive would expose every export
// here as a public Server Action endpoint, callable without a session.
// These are plain helpers used from within actions/transactions only.

/**
 * Must be called from inside the same `$transaction` that creates the
 * Invoice/Quote row, passing that transaction's client as `db`. Reading the
 * max sequence and creating the row in separate transactions lets two
 * concurrent requests read the same max and collide on the same number.
 */
export async function generateInvoiceNumber(db: DbClient = prisma): Promise<string> {
  const settings = await db.applicationSettings.findFirst();
  const prefix = settings?.invoiceNumberPrefix ?? "R-";
  return generateNumber(db, prefix, "invoice");
}

export async function generateQuoteNumber(db: DbClient = prisma): Promise<string> {
  const settings = await db.applicationSettings.findFirst();
  const prefix = settings?.quoteNumberPrefix ?? "O-";
  return generateNumber(db, prefix, "quote");
}

async function generateNumber(
  db: DbClient,
  prefix: string,
  type: "invoice" | "quote"
): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  let maxSeq = 0;

  if (type === "invoice") {
    const latest = await db.invoice.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    for (const inv of latest) {
      const seq = parseInt(inv.documentNumber.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  } else {
    const latest = await db.quote.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    for (const q of latest) {
      const seq = parseInt(q.documentNumber.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const next = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${yy}${mm}${next}`;
}
