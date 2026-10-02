import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import type { Session } from "next-auth";
import { appendAuditEntry, type AuditEntryInput } from "@/lib/audit-chain";

const log = logger.child({ module: "audit" });

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "SEND" | "STATUS" | "EXPORT";
export type AuditEntity = "Customer" | "Invoice" | "Quote" | "Reminder" | "Service" | "User" | "Settings" | "CustomerNote" | "CustomerContact" | "Expense" | "Payment" | "SentDocument" | "ExpenseReceipt" | "BankStatementImport" | "Subscription" | "YearPackage" | "Task" | "InvoiceTemplate" | "Backup" | "LogFile";

/**
 * Writes one hash-chained audit row. Never throws: audit logging must not
 * break the main operation, but a silent failure would hide that the trail
 * has gaps — surface it to the log.
 */
export async function logAuditEntry(
  entry: AuditEntryInput,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  try {
    await appendAuditEntry(prisma, entry);
  } catch (err) {
    log.error(
      { err, action: entry.action, entityType: entry.entityType, entityId: entry.entityId },
      "Failed to write audit log"
    );
  }
}

export async function logAudit(
  session: Session,
  action: AuditAction,
  entityType: AuditEntity,
  entityId?: number,
  entityRef?: string,
  details?: Record<string, unknown>,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  await logAuditEntry(
    {
      userId: parseInt(session.user.id, 10),
      userName: session.user.name ?? session.user.email ?? "Unbekannt",
      action,
      entityType,
      entityId: entityId ?? null,
      entityRef: entityRef ?? null,
      details: details ? JSON.stringify(details) : null,
    },
    prisma
  );
}
