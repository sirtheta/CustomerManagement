import { itemDataSchema, type ItemData } from "@/components/items-editor-schema";
import { calculateInvoiceTotal, calculateItemTotal, type TotalOptions } from "@/lib/calculations";

export type ParsedItems = {
  items: ItemData[];
  totalAmount: number;
  discountPercent: number;
};

export function parseDocumentItems(formData: FormData, totalOptions: TotalOptions = {}): ParsedItems {
  const itemsJson = (formData.get("itemsJson") as string) || "[]";
  const items = itemDataSchema.array().parse(JSON.parse(itemsJson)).map((item) => ({
    ...item,
    totalAmount: calculateItemTotal(item),
  }));
  const rawDiscount = formData.get("discountPercent");
  const discountPercent = rawDiscount === null || rawDiscount === ""
    ? 0
    : Number(String(rawDiscount).replace(",", "."));
  const totalAmount = calculateInvoiceTotal(items, discountPercent, totalOptions);
  return { items, totalAmount, discountPercent };
}
