export type DiscountedItem = {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
};

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

export function calculateInvoiceTotal(
  items: DiscountedItem[],
  discountPercent = 0
): number {
  if (!validateDiscountPercent(discountPercent)) {
    throw new Error("Rabatt muss zwischen 0 und 100 Prozent liegen.");
  }
  const itemTotal = items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
  return roundCents(itemTotal * (1 - discountPercent / 100));
}