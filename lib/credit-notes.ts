import defaultPrisma from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ItemData } from "@/components/items-editor-schema";
import { sumCreditedRappen, toRappen } from "@/lib/payments";

// Deliberately no "use server": plain helpers, used from actions only.

type Db = PrismaClient | Prisma.TransactionClient;

/** Validation error whose message is safe to show in the UI. */
export class CreditNoteError extends Error {}

/**
 * The form shows credit notes with positive amounts; the database stores them
 * negative (quantity, item totals and document total). Unit price and
 * discounts stay as they are.
 */
export function negateDocumentInput<T extends { items: ItemData[]; totalAmount: number }>(input: T): T {
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return {
    ...input,
    totalAmount: neg(input.totalAmount),
    items: input.items.map((item) => ({
      ...item,
      quantity: neg(item.quantity),
      totalAmount: neg(item.totalAmount),
    })),
  };
}

/**
 * Creates a credit note draft for a sent invoice, copying all items with
 * negated quantities. The user then removes or adjusts items (partial credit)
 * and sends it.
 */
export async function createCreditNoteDraft(
  originalId: number,
  prisma: PrismaClient = defaultPrisma
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const original = await tx.invoice.findUnique({
      where: { id: originalId },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!original) throw new CreditNoteError("Rechnung nicht gefunden.");
    if (original.creditNoteForId != null) {
      throw new CreditNoteError("Zu einer Gutschrift kann keine weitere Gutschrift erstellt werden.");
    }
    if (original.state === "Draft") {
      throw new CreditNoteError("Entwürfe lassen sich direkt bearbeiten oder löschen.");
    }
    if (original.state === "Canceled") {
      throw new CreditNoteError("Die Rechnung ist bereits vollständig gutgeschrieben.");
    }

    const now = new Date();
    const credit = await tx.invoice.create({
      data: {
        customerId: original.customerId,
        customUserText: original.customUserText,
        date: now,
        // A credit note has nothing to pay; the column is required, so reuse the date.
        dueDate: now,
        totalAmount: original.totalAmount.negated(),
        discountPercent: original.discountPercent,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });
    if (original.items.length > 0) {
      await tx.item.createMany({
        data: original.items.map((item) => ({
          invoiceId: credit.id,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: item.quantity.negated(),
          discountPercent: item.discountPercent,
          totalAmount: item.totalAmount.negated(),
          customText: item.customText,
          categoryId: item.categoryId,
        })),
      });
    }
    return credit.id;
  });
}

/**
 * Credit notes of an invoice together must not exceed the original total.
 * Counts the already sent credit notes plus the one being saved or sent.
 */
export async function assertCreditWithinOriginal(
  db: Db,
  creditNote: { id: number; creditNoteForId: number; totalAmount: { toNumber(): number } | number }
): Promise<void> {
  const ownRappen = Math.abs(toRappen(creditNote.totalAmount));
  if (ownRappen === 0) throw new CreditNoteError("Die Gutschrift muss einen Betrag haben.");

  const original = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.creditNoteForId },
    select: { totalAmount: true },
  });
  // The credit note itself counts through ownRappen, so exclude it when it is already sent.
  const sentRappen = await sumCreditedRappen(db, creditNote.creditNoteForId);
  const self = await db.invoice.findUnique({ where: { id: creditNote.id }, select: { state: true, totalAmount: true } });
  const alreadyCounted = self && self.state !== "Draft" ? Math.abs(toRappen(self.totalAmount)) : 0;

  if (sentRappen - alreadyCounted + ownRappen > toRappen(original.totalAmount)) {
    throw new CreditNoteError("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
  }
}
