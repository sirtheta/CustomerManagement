import defaultPrisma from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ItemData } from "@/components/items-editor-schema";
import { sumCreditedRappen } from "@/lib/payments";
import { calculateInvoiceTotal, toRappen, type TotalOptions } from "@/lib/calculations";

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

/** Sent credit notes of the original, not counting the credit note `selfId` itself. */
async function sentCreditsExcludingSelf(db: Db, originalId: number, selfId: number): Promise<number> {
  const sentRappen = await sumCreditedRappen(db, originalId);
  const self = await db.invoice.findUnique({ where: { id: selfId }, select: { state: true, totalAmount: true } });
  const alreadyCounted = self && self.state !== "Draft" ? Math.abs(toRappen(self.totalAmount)) : 0;
  return sentRappen - alreadyCounted;
}

/**
 * Rounding to 5 Rappen is a switch, so the original and its credit note can
 * have been rounded differently (switch toggled in between): a full credit
 * would then cover the original minus 1-4 Rappen (a remainder stays open and the
 * invoice never settles) or exceed it by that much (and be refused). When the
 * credit total is 1-4 Rappen away from what the original still has open and
 * rounding explains it (the switch is on now, or the original's stored total is
 * not the plain total of its items), the credit note takes exactly the open
 * amount. Without rounding on either side nothing is adjusted, and 5 Rappen or
 * more apart is a deliberate partial credit.
 *
 * Takes and returns the negative total in francs; the item totals stay as they are.
 */
export async function alignCreditToOriginal(
  db: Db,
  creditNote: { id: number; creditNoteForId: number; totalAmount: number },
  options: TotalOptions = {}
): Promise<number> {
  const ownRappen = -toRappen(creditNote.totalAmount);
  if (ownRappen <= 0) return creditNote.totalAmount;

  const original = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.creditNoteForId },
    select: {
      totalAmount: true,
      discountPercent: true,
      items: { select: { quantity: true, unitPrice: true, discountPercent: true } },
    },
  });
  const originalRappen = toRappen(original.totalAmount);
  const openRappen = originalRappen - (await sentCreditsExcludingSelf(db, creditNote.creditNoteForId, creditNote.id));
  const gap = openRappen - ownRappen;
  if (openRappen <= 0 || gap === 0 || Math.abs(gap) > 4) return creditNote.totalAmount;

  const plainRappen = toRappen(
    calculateInvoiceTotal(
      original.items.map((i) => ({
        quantity: i.quantity.toNumber(),
        unitPrice: i.unitPrice.toNumber(),
        discountPercent: i.discountPercent.toNumber(),
      })),
      original.discountPercent.toNumber()
    )
  );
  const originalWasRounded = plainRappen !== originalRappen;
  if (!options.roundTo5Rappen && !originalWasRounded) return creditNote.totalAmount;
  return -openRappen / 100;
}

/**
 * Credit notes of an invoice together must not exceed the original total.
 * Counts the already sent credit notes plus the one being saved or sent.
 */
export async function assertCreditWithinOriginal(
  db: Db,
  creditNote: { id: number; creditNoteForId: number; totalAmount: { toNumber(): number } | number }
): Promise<void> {
  const storedRappen = toRappen(creditNote.totalAmount);
  if (storedRappen === 0) throw new CreditNoteError("Die Gutschrift muss einen Betrag haben.");
  // Stored negative; a positive one would charge the customer, yet still count
  // (as absolute value) against the original's open amount.
  if (storedRappen > 0) {
    throw new CreditNoteError("Eine Gutschrift muss den Rechnungsbetrag verringern, nicht erhöhen.");
  }
  const ownRappen = -storedRappen;

  const original = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.creditNoteForId },
    select: { totalAmount: true },
  });
  // The credit note itself counts through ownRappen, so exclude it when it is already sent.
  const sentRappen = await sentCreditsExcludingSelf(db, creditNote.creditNoteForId, creditNote.id);

  if (sentRappen + ownRappen > toRappen(original.totalAmount)) {
    throw new CreditNoteError("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
  }
}
