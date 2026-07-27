import { itemDataSchema, type ItemData } from "@/components/items-editor-schema";

export type ParsedItems = {
  items: ItemData[];
  totalAmount: number;
};

export function parseDocumentItems(formData: FormData): ParsedItems {
  const itemsJson = (formData.get("itemsJson") as string) || "[]";
  const items: ItemData[] = itemDataSchema.array().parse(JSON.parse(itemsJson));
  const totalAmount = items.reduce((sum, item) => sum + Number(item.totalAmount), 0);
  return { items, totalAmount };
}
