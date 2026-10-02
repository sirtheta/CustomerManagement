import type { PrismaClient } from "@prisma/client";

export const FIRST_CUSTOMER_NUMBER = 1001;

/** Highest assigned number plus one (at least 1001). Race losers retry on P2002 in the caller. */
export async function nextCustomerNumber(db: Pick<PrismaClient, "customer">): Promise<number> {
  const result = await db.customer.aggregate({ _max: { customerNumber: true } });
  const max = result?._max?.customerNumber ?? null;
  return max === null ? FIRST_CUSTOMER_NUMBER : Math.max(max + 1, FIRST_CUSTOMER_NUMBER);
}
