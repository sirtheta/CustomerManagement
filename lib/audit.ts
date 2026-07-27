import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import type { Session } from "next-auth";

const log = logger.child({ module: "audit" });

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "SEND" | "STATUS";
export type AuditEntity = "Customer" | "Invoice" | "Quote" | "Reminder" | "Service" | "User" | "Settings" | "CustomerNote" | "Expense";

export async function logAudit(
  session: Session,
  action: AuditAction,
  entityType: AuditEntity,
  entityId?: number,
  entityRef?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: parseInt(session.user.id, 10),
        userName: session.user.name ?? session.user.email ?? "Unbekannt",
        action,
        entityType,
        entityId: entityId ?? null,
        entityRef: entityRef ?? null,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    // Audit logging must never break the main operation, but a silent
    // failure would hide that the trail has gaps — surface it to the log.
    log.error({ err, action, entityType, entityId }, "Failed to write audit log");
  }
}
