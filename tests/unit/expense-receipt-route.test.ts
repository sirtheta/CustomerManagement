import { describe, it, expect, vi, beforeEach } from "vitest";

const moduleDisabledResponse = vi.fn<(key: string) => Promise<Response | null>>(async () => null);
vi.mock("@/lib/module-guard", () => ({
  moduleDisabledResponse: (key: string) => moduleDisabledResponse(key),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "1", name: "Editor", role: "Editor" } })),
}));
vi.mock("@/lib/prisma", () => ({
  default: { expenseReceipt: { findUnique: vi.fn() } },
}));

import { GET } from "@/app/api/expenses/receipts/[id]/route";
import prisma from "@/lib/prisma";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/expenses/receipts/3");

describe("GET /api/expenses/receipts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.expenseReceipt.findUnique).mockResolvedValue({
      id: 3,
      name: "beleg.pdf",
      fileType: "pdf",
      content: Buffer.from("%PDF"),
    } as never);
  });

  it("answers 404 without reading the receipt while accounting is switched off", async () => {
    moduleDisabledResponse.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await GET(req(), ctx("3"));
    expect(res.status).toBe(404);
    expect(moduleDisabledResponse).toHaveBeenCalledWith("accounting");
    expect(prisma.expenseReceipt.findUnique).not.toHaveBeenCalled();
  });

  it("serves the receipt without letting caches store it", async () => {
    const res = await GET(req(), ctx("3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
