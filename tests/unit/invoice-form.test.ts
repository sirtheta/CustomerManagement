import { describe, it, expect } from "vitest";
import { serializeInvoiceForForm } from "@/lib/invoice-form";

const d = (n: number) => ({ toNumber: () => n });

function make(creditNoteForId: number | null, sign: 1 | -1) {
  return {
    id: 1,
    creditNoteForId,
    totalAmount: d(100 * sign),
    discountPercent: d(0),
    items: [
      { id: 1, unitPrice: d(50), quantity: d(2 * sign), discountPercent: d(0), totalAmount: d(100 * sign) },
    ],
  } as unknown as Parameters<typeof serializeInvoiceForForm>[0];
}

describe("serializeInvoiceForForm", () => {
  it("shows credit note amounts positive", () => {
    const out = serializeInvoiceForForm(make(7, -1));
    expect(out.totalAmount).toBe(100);
    expect(out.items[0].quantity).toBe(2);
    expect(out.items[0].totalAmount).toBe(100);
    expect(out.items[0].unitPrice).toBe(50);
  });

  it("leaves regular invoices unchanged", () => {
    const out = serializeInvoiceForForm(make(null, 1));
    expect(out.totalAmount).toBe(100);
    expect(out.items[0].quantity).toBe(2);
  });
});
