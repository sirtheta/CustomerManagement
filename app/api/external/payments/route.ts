import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { matchAndMarkPaid } from "@/lib/payment-matching";
import logger from "@/lib/logger";

// Called by the Budget app (separate container) after a bank import, to check
// an incoming payment against open invoices. Manual test (dev servers running,
// BUDGET_INTEGRATION_API_KEY set here):
//
//   curl -X POST http://localhost:3000/api/external/payments \
//     -H "Content-Type: application/json" \
//     -H "x-api-key: <BUDGET_INTEGRATION_API_KEY>" \
//     -d '{"description":"Zahlung Rechnung R-26070042","amountRappen":12345}'
//
// -> {"matched":true,...} on a hit, {"matched":false} otherwise.

const log = logger.child({ module: "external-payments" });

const bodySchema = z.object({
  description: z.string().min(1).max(500),
  amountRappen: z.number().int(),
  bookingDate: z.string().optional(),
});

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.BUDGET_INTEGRATION_API_KEY;
  if (!expected) return false;

  const provided = req.headers.get("x-api-key") ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad Request" }, { status: 400 });
  }

  try {
    const result = await matchAndMarkPaid(parsed.data);
    return Response.json(result);
  } catch (err) {
    log.error({ err }, "matchAndMarkPaid failed");
    return Response.json({ matched: false }, { status: 200 });
  }
}
