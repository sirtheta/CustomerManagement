export type DiscountedItem = {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
};

/** Francs (number or Prisma Decimal) to whole Rappen, `Math.round`, sign kept. */
export function toRappen(value: number | { toNumber(): number }): number {
  const n = typeof value === "number" ? value : value.toNumber();
  return Math.round(n * 100);
}

function roundCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function validateDiscountPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function calculateItemTotal(item: DiscountedItem): number {
  const discount = item.discountPercent ?? 0;
  if (!validateDiscountPercent(discount)) {
    throw new Error("Rabatt muss zwischen 0 und 100 Prozent liegen.");
  }
  return roundCents(item.quantity * item.unitPrice * (1 - discount / 100));
}

export type TotalOptions = {
  /** Round the document total (not the items) to 5 Rappen (Einstellungen -> Rechnungsbetrag auf 5 Rappen runden). */
  roundTo5Rappen?: boolean;
};

/**
 * Rounds to the nearest 5 Rappen. Totals are whole Rappen, so there are no
 * ties; negative amounts (credit notes) round mirrored to positive ones.
 */
export function roundTo5Rappen(amount: number): number {
  const rappen = Math.round(Math.abs(amount) * 100);
  const rounded = (Math.round(rappen / 5) * 5) / 100;
  return (amount < 0 ? -rounded : rounded) + 0;
}

export function calculateInvoiceTotal(
  items: DiscountedItem[],
  discountPercent = 0,
  options: TotalOptions = {}
): number {
  if (!validateDiscountPercent(discountPercent)) {
    throw new Error("Rabatt muss zwischen 0 und 100 Prozent liegen.");
  }
  const itemTotal = items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
  const total = roundCents(itemTotal * (1 - discountPercent / 100));
  return options.roundTo5Rappen ? roundTo5Rappen(total) : total;
}

/**
 * Splits the difference between the item subtotal and the stored total into the
 * invoice discount and the rounding, so the PDF shows each on its own line.
 * A credit note (negative subtotal) gets the mirrored lines of its invoice.
 */
export function splitTotals(
  subtotal: number,
  discountPercent: number,
  totalAmount: number
): { discountAmount: number; rounding: number } {
  // roundCents rounds half-Rappen towards +infinity, so compute on the positive
  // form (as the credit note form did) and apply the sign afterwards.
  const sign = subtotal < 0 ? -1 : 1;
  const positive = subtotal * sign;
  const discounted = roundCents(positive * (1 - discountPercent / 100));
  return {
    discountAmount: sign * roundCents(positive - discounted) + 0,
    rounding: sign * roundCents(totalAmount * sign - discounted) + 0,
  };
}