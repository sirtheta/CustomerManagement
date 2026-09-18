"use server";

import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { parseCamt053 } from "@/lib/import/camt";
import { matchStatementToInvoices, type MatchedTransaction } from "@/lib/import/matching";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoices.import" });

export type ParseStatementState = {
  error?: string;
  matches?: MatchedTransaction[];
  warnings?: string[];
};

/**
 * Parses an uploaded CAMT.053 file and matches its incoming payments against
 * currently open invoices (`Sent`/`Overdue`). Nothing is written to the
 * database here — matches only become a state change once the user reviews
 * and confirms them via `markInvoicesPaidFromImport`.
 */
export async function parseStatement(
  _prev: ParseStatementState,
  formData: FormData
): Promise<ParseStatementState> {
  await requireEditor();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte eine CAMT.053-Datei (.xml) auswählen." };
  }

  const xml = await file.text();

  let statement;
  try {
    statement = parseCamt053(xml);
  } catch (err) {
    log.error({ err }, "parseStatement: CAMT parse failed");
    const message = err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.";
    return { error: message };
  }

  const [openInvoices, settings] = await Promise.all([
    prisma.invoice.findMany({
      where: { state: { in: ["Sent", "Overdue"] } },
      select: { id: true, documentNumber: true, totalAmount: true },
    }),
    prisma.applicationSettings.findFirst({ select: { invoiceNumberPrefix: true } }),
  ]);

  const matches = matchStatementToInvoices(
    statement.transactions,
    openInvoices.map((invoice) => ({
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      totalAmount: invoice.totalAmount.toNumber(),
    })),
    settings?.invoiceNumberPrefix ?? "R-"
  );

  return { matches, warnings: statement.warnings };
}
