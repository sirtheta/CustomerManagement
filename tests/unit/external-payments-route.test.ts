import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/payment-matching", () => ({ matchAndMarkPaid: vi.fn() }));

import { POST } from "@/app/api/external/payments/route";
import { matchAndMarkPaid } from "@/lib/payment-matching";
import { revalidateTag } from "next/cache";

const ENDPOINT = "http://localhost/api/external/payments";
const API_KEY = "test-integration-key";

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/external/payments", () => {
  const originalKey = process.env.BUDGET_INTEGRATION_API_KEY;

  beforeEach(() => {
    process.env.BUDGET_INTEGRATION_API_KEY = API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.BUDGET_INTEGRATION_API_KEY = originalKey;
  });

  it("rejects a request without an api key", async () => {
    const res = await POST(req({ description: "R-2607", amountRappen: 100 }));
    expect(res.status).toBe(401);
    expect(matchAndMarkPaid).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong api key", async () => {
    const res = await POST(
      req({ description: "R-2607", amountRappen: 100 }, { "x-api-key": "wrong" })
    );
    expect(res.status).toBe(401);
    expect(matchAndMarkPaid).not.toHaveBeenCalled();
  });

  it("rejects a request when no api key is configured on the server", async () => {
    delete process.env.BUDGET_INTEGRATION_API_KEY;
    const res = await POST(
      req({ description: "R-2607", amountRappen: 100 }, { "x-api-key": "" })
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(
      req({ description: "", amountRappen: "not-a-number" }, { "x-api-key": API_KEY })
    );
    expect(res.status).toBe(400);
    expect(matchAndMarkPaid).not.toHaveBeenCalled();
  });

  it("rejects an unparseable JSON body", async () => {
    const res = await POST(
      new NextRequest(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns matched:true and revalidates analytics on a hit", async () => {
    vi.mocked(matchAndMarkPaid).mockResolvedValue({
      matched: true,
      invoiceId: 42,
      documentNumber: "R-260700042",
    });

    const res = await POST(
      req({ description: "Zahlung R-260700042", amountRappen: 12345 }, { "x-api-key": API_KEY })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matched: true, invoiceId: 42, documentNumber: "R-260700042" });
    expect(revalidateTag).toHaveBeenCalled();
  });

  it("returns matched:false without revalidating on a miss", async () => {
    vi.mocked(matchAndMarkPaid).mockResolvedValue({ matched: false });

    const res = await POST(
      req({ description: "unrelated", amountRappen: 1 }, { "x-api-key": API_KEY })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matched: false });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("swallows a matchAndMarkPaid exception into a silent 200 matched:false", async () => {
    vi.mocked(matchAndMarkPaid).mockRejectedValue(new Error("db down"));

    const res = await POST(
      req({ description: "R-260700042", amountRappen: 12345 }, { "x-api-key": API_KEY })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matched: false });
  });
});
