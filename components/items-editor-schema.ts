import { z } from "zod";

export const itemDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  unit: z.enum(["Hour", "Day", "Piece", "Package"]),
  unitPrice: z.number(),
  quantity: z.number(),
  discountPercent: z.number().min(0).max(100).default(0),
  totalAmount: z.number(),
  customText: z.string(),
  categoryId: z.number().nullable(),
  isCustom: z.boolean().optional(),
  saveToCatalog: z.boolean().optional(),
  includeDescription: z.boolean().optional(),
});

export type ItemData = z.infer<typeof itemDataSchema>;
