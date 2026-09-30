import type { Prisma } from "@prisma/client";

/**
 * Customers offered in pickers for new documents: archived ones are hidden,
 * except the one a document already belongs to (so editing a draft of a
 * customer that was archived later still shows its customer).
 */
export function selectableCustomersWhere(currentId?: number): Prisma.CustomerWhereInput {
  return currentId === undefined
    ? { archivedAt: null }
    : { OR: [{ archivedAt: null }, { customerId: currentId }] };
}
