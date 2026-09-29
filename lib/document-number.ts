import prisma from "@/lib/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";

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
      const seq = parseInt((inv.documentNumber ?? "").slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  } else {
    const latest = await db.quote.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    for (const q of latest) {
      const seq = parseInt((q.documentNumber ?? "").slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const next = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${yy}${mm}${next}`;
}

export type DocumentKind = "invoice" | "quote";

export function isDocumentNumberCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    ((err.meta?.target as string[] | undefined)?.includes("documentNumber") ?? false)
  );
}

/**
 * Gives a draft its final number, at the moment it first leaves the house
 * (send, pending-mail approval, manual status change). Idempotent: an
 * already numbered document keeps its number. Runs its own transaction so a
 * number collision can be retried in a fresh one.
 */
export async function assignDocumentNumber(
  kind: DocumentKind,
  id: number,
  options: { actor?: Session; client?: PrismaClient } = {}
): Promise<string> {
  const client = options.client ?? prisma;

  const attempt = () =>
    client.$transaction(async (tx) => {
      const current =
        kind === "invoice"
          ? await tx.invoice.findUnique({ where: { id }, select: { documentNumber: true } })
          : await tx.quote.findUnique({ where: { id }, select: { documentNumber: true } });
      if (!current) throw new Error("Dokument nicht gefunden.");
      if (current.documentNumber) return { documentNumber: current.documentNumber, assigned: false };

      const documentNumber =
        kind === "invoice" ? await generateInvoiceNumber(tx) : await generateQuoteNumber(tx);
      const where = { id, documentNumber: null };
      const { count } =
        kind === "invoice"
          ? await tx.invoice.updateMany({ where, data: { documentNumber } })
          : await tx.quote.updateMany({ where, data: { documentNumber } });

      if (count === 0) {
        // A concurrent call numbered it first; return the winner's number.
        const winner =
          kind === "invoice"
            ? await tx.invoice.findUnique({ where: { id }, select: { documentNumber: true } })
            : await tx.quote.findUnique({ where: { id }, select: { documentNumber: true } });
        return { documentNumber: winner!.documentNumber!, assigned: false };
      }
      return { documentNumber, assigned: true };
    });

  let result;
  try {
    result = await attempt();
  } catch (err) {
    if (!isDocumentNumberCollision(err)) throw err;
    result = await attempt();
  }

  if (result.assigned && options.actor) {
    await logAudit(
      options.actor,
      "UPDATE",
      kind === "invoice" ? "Invoice" : "Quote",
      id,
      result.documentNumber,
      { documentNumber: result.documentNumber },
      client
    );
  }
  return result.documentNumber;
}
