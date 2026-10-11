import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createDocumentWithItems } from "@/lib/document-actions";
import { assertCustomerActive } from "@/lib/customer-archive";
import { effectivePaymentTermDays } from "@/lib/customer-billing";
import { addDays, swissDateString, swissToday } from "@/lib/date";
import { loadTotalOptions } from "@/lib/total-options";
import { billingTotal, buildBillingLines, toItemData, type BillableService } from "@/lib/work-billing";

export class WorkBillingError extends Error {}

export const NO_ENTRIES_ERROR = "Bitte mindestens einen Eintrag auswählen.";
export const WORK_ALREADY_BILLED_ERROR =
  "Mindestens ein Eintrag wurde inzwischen verrechnet, geändert oder gehört nicht zu diesem Kunden. Bitte die Seite neu laden.";

/**
 * Marks the entries as billed by `invoiceId`. Succeeds only when every entry is still open, belongs to
 * the customer and has not changed since it was read (`updatedAt`), because the invoice lines were built
 * from exactly that state. Throws otherwise, which rolls the surrounding transaction back (a double
 * click, a second tab, or an edit made while the draft was being created). It checks with an `id IN (...)`
 * lookup instead of an OR list of (id, updatedAt) pairs, which hits SQLite's expression depth limit
 * at about 1000 entries.
 */
export async function claimWorkEntries(
  tx: Prisma.TransactionClient,
  customerId: number,
  entries: { id: number; updatedAt: Date }[],
  invoiceId: number
): Promise<void> {
  const ids = entries.map((e) => e.id);
  const readAt = new Map(entries.map((e) => [e.id, e.updatedAt.getTime()]));
  const where = { id: { in: ids }, customerId, invoiceId: null };

  // Check-then-update is race-free: the Prisma better-sqlite3 adapter serialises interactive
  // transactions, so no other writer can change these rows between the lookup and the update.
  const current = await tx.workEntry.findMany({ where, select: { id: true, updatedAt: true } });
  if (current.length !== entries.length || current.some((row) => row.updatedAt.getTime() !== readAt.get(row.id))) {
    throw new WorkBillingError(WORK_ALREADY_BILLED_ERROR);
  }

  const { count } = await tx.workEntry.updateMany({ where, data: { invoiceId } });
  if (count !== entries.length) throw new WorkBillingError(WORK_ALREADY_BILLED_ERROR);
}

/**
 * Creates a draft invoice from open work entries and marks them billed in the same transaction.
 * Throws `WorkBillingError` (German message) when the selection is empty, the customer is
 * archived, or an entry is already billed, was changed meanwhile, or belongs to another customer.
 */
export async function createInvoiceFromWorkEntries(
  customerId: number,
  entryIds: number[]
): Promise<{ id: number; entryCount: number }> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) throw new WorkBillingError(NO_ENTRIES_ERROR);

  const customerError = await assertCustomerActive(prisma, customerId);
  if (customerError) throw new WorkBillingError(customerError);

  const entries = await prisma.workEntry.findMany({
    where: { id: { in: ids }, customerId, invoiceId: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  if (entries.length !== ids.length) throw new WorkBillingError(WORK_ALREADY_BILLED_ERROR);

  const serviceIds = [...new Set(entries.flatMap((e) => (e.serviceId === null ? [] : [e.serviceId])))];
  const serviceRows = await prisma.service.findMany({ where: { id: { in: serviceIds } } });
  const services: Record<number, BillableService> = Object.fromEntries(
    serviceRows.map((s) => [
      s.id,
      { name: s.name, description: s.description, unit: s.unit, unitPrice: Number(s.unitPrice), categoryId: s.categoryId },
    ])
  );

  const [customer, settings, totalOptions] = await Promise.all([
    prisma.customer.findUnique({ where: { customerId }, select: { paymentTermDays: true } }),
    prisma.applicationSettings.findFirst({ select: { defaultPaymentTermDays: true } }),
    loadTotalOptions(),
  ]);
  const termDays = effectivePaymentTermDays(customer, settings?.defaultPaymentTermDays ?? 30);

  const lines = buildBillingLines(
    entries.map((e) => ({
      id: e.id,
      date: e.date,
      serviceId: e.serviceId,
      name: e.name,
      unit: e.unit,
      quantity: Number(e.quantity),
    })),
    services
  );

  const { id } = await createDocumentWithItems(
    {
      kind: "invoice",
      customerId,
      customUserText: null,
      date: swissToday(),
      dueDate: new Date(`${addDays(swissDateString(), termDays)}T00:00:00.000Z`),
      totalAmount: billingTotal(lines, totalOptions),
      discountPercent: 0,
      items: lines.map(toItemData),
    },
    {
      // Claim the entries inside the invoice transaction: a concurrent second billing, or an entry
      // edited since it was read, matches fewer rows, throws here, and the invoice is rolled back.
      onCreated: (tx, invoiceId) => claimWorkEntries(tx, customerId, entries, invoiceId),
    }
  );
  return { id, entryCount: ids.length };
}
