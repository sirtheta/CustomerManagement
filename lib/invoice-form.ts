import type { Invoice, Item } from "@prisma/client";

type Decimalish = { toNumber(): number };
type InvoiceWithItems = Omit<Invoice, "totalAmount" | "discountPercent"> & {
  totalAmount: Decimalish;
  discountPercent: Decimalish;
  items: (Omit<Item, "unitPrice" | "quantity" | "discountPercent" | "totalAmount"> & {
    unitPrice: Decimalish;
    quantity: Decimalish;
    discountPercent: Decimalish;
    totalAmount: Decimalish;
  })[];
};

/**
 * Serializes an invoice for the edit form. Credit notes are stored negative
 * but the form works with positive amounts (the server negates on save), so
 * quantities and totals are flipped back for them.
 */
export function serializeInvoiceForForm(invoice: InvoiceWithItems) {
  const sign = invoice.creditNoteForId !== null ? -1 : 1;
  const flip = (n: number) => (n === 0 ? 0 : n * sign);
  return {
    ...invoice,
    totalAmount: flip(invoice.totalAmount.toNumber()),
    discountPercent: invoice.discountPercent.toNumber(),
    items: invoice.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      quantity: flip(item.quantity.toNumber()),
      discountPercent: item.discountPercent.toNumber(),
      totalAmount: flip(item.totalAmount.toNumber()),
    })),
  };
}
