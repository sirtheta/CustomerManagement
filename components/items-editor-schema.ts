import { z } from "zod";

export const itemDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  unit: z.enum(["Hour", "Day", "Piece", "Package"]),
  unitPrice: z.number(),
  quantity: z.number(),
  totalAmount: z.number(),
  customText: z.string(),
  categoryId: z.number().nullable(),
});

export type ItemData = z.infer<typeof itemDataSchema>;
