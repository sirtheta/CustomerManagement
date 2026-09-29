import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));

vi.mock("@/lib/prisma", () => ({
  default: {
    quote: { findUnique: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateQuotePdf: vi.fn() }));
vi.mock("@/lib/pdf/pdf-cache", () => ({ readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("@/lib/pdf/theme", () => ({ themeRevision: () => "1" }));

import { GET } from "@/app/api/quotes/[id]/pdf/route";
import prisma from "@/lib/prisma";
import { readCache } from "@/lib/pdf/pdf-cache";

function req() {
  return new NextRequest("http://localhost/api/quotes/5/pdf");
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/quotes/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSession = {
      user: { id: "1", name: "Test", email: "t@example.com", role: "Editor" },
      expires: "2099-01-01",
    } as Session;
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
      pdfTheme: null,
      companyInfo: {},
    } as never);
    vi.mocked(readCache).mockResolvedValue(Buffer.from("x"));
  });

  it("uses a draft file name and a cache key without number for drafts", async () => {
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 5,
      documentNumber: null,
      version: 1,
    } as never);

    const res = await GET(req(), ctx("5"));

    expect(res.headers.get("Content-Disposition")).toContain('filename="entwurf-5.pdf"');
    expect(readCache).toHaveBeenCalledWith("quote-5-v1-ndraft-t1");
  });

  it("includes the number in the cache key once assigned", async () => {
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 5,
      documentNumber: "O-26090001",
      version: 1,
    } as never);

    const res = await GET(req(), ctx("5"));

    expect(res.headers.get("Content-Disposition")).toContain('filename="offerte-O-26090001.pdf"');
    expect(readCache).toHaveBeenCalledWith("quote-5-v1-nO-26090001-t1");
  });
});
