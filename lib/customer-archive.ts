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

/** Sentence for the archive dialog: subscriptions of archived customers are not billed. */
export function archiveSubscriptionNote(activeSubscriptions: number): string {
  if (activeSubscriptions <= 0) return "";
  return activeSubscriptions === 1
    ? "Dieser Kunde hat 1 aktives Abo. Es wird nicht mehr verrechnet, solange er archiviert ist."
    : `Dieser Kunde hat ${activeSubscriptions} aktive Abos. Sie werden nicht mehr verrechnet, solange er archiviert ist.`;
}

export const CUSTOMER_ARCHIVED_ERROR = "Der Kunde ist archiviert. Bitte zuerst wiederherstellen.";
export const CUSTOMER_NOT_FOUND_ERROR = "Kunde nicht gefunden.";

type CustomerLookup = {
  customer: {
    findUnique(args: {
      where: { customerId: number };
      select: { archivedAt: true };
    }): PromiseLike<{ archivedAt: Date | null } | null>;
  };
};

/**
 * Server-side counterpart of `selectableCustomersWhere`: the pickers hide
 * archived customers, but a Server Action also receives crafted ids. Returns a
 * German error message when new work may not be attached to the customer
 * (missing or archived), otherwise null.
 *
 * `currentCustomerId` is the customer an existing document already belongs to:
 * keeping it is allowed, so a draft of a customer archived later can still be
 * corrected. Only moving a document to an archived customer is refused.
 */
export async function assertCustomerActive(
  db: CustomerLookup,
  customerId: number,
  currentCustomerId?: number
): Promise<string | null> {
  if (currentCustomerId !== undefined && customerId === currentCustomerId) return null;
  if (!Number.isInteger(customerId)) return CUSTOMER_NOT_FOUND_ERROR;
  const customer = await db.customer.findUnique({ where: { customerId }, select: { archivedAt: true } });
  if (!customer) return CUSTOMER_NOT_FOUND_ERROR;
  return customer.archivedAt ? CUSTOMER_ARCHIVED_ERROR : null;
}
