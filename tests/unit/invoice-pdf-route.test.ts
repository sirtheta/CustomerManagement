import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findUnique: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("@/lib/pdf/pdf-cache", () => ({ readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("@/lib/pdf/theme", () => ({ themeRevision: () => "1" }));

import { GET } from "@/app/api/invoices/[id]/pdf/route";
import prisma from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { readCache, writeCache } from "@/lib/pdf/pdf-cache";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

function req() {
  return new NextRequest("http://localhost/api/invoices/1/pdf");
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const invoice = { id: 1, documentNumber: "I-260700001", version: 3 };
const settings = { pdfTheme: null, companyInfo: {} };

describe("GET /api/invoices/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSession = sessionFor("Editor");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(invoice as never);
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(settings as never);
  });

  it("rejects an unauthenticated request", async () => {
    currentSession = null;
    const res = await GET(req(), ctx("1"));
    expect(res.status).toBe(401);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("404s for a non-existent invoice", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    const res = await GET(req(), ctx("1"));
    expect(res.status).toBe(404);
  });

  it("400s for a non-numeric id", async () => {
    const res = await GET(req(), ctx("abc"));
    expect(res.status).toBe(400);
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("serves the cached PDF without regenerating when the cache key hits", async () => {
    vi.mocked(readCache).mockResolvedValue(Buffer.from("cached-pdf-bytes"));

    const res = await GET(req(), ctx("1"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cached-pdf-bytes");
    expect(readCache).toHaveBeenCalledWith("inv-1-v3-t1");
    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("regenerates and caches the PDF on a cache miss", async () => {
    vi.mocked(readCache).mockResolvedValue(null);
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("fresh-pdf-bytes"));

    const res = await GET(req(), ctx("1"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fresh-pdf-bytes");
    expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
    expect(writeCache).toHaveBeenCalledWith("inv-1-v3-t1", Buffer.from("fresh-pdf-bytes"));
  });

  it("keys the cache on the invoice version, invalidating after an edit", async () => {
    vi.mocked(readCache).mockResolvedValue(null);
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("v4-pdf"));
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ ...invoice, version: 4 } as never);

    await GET(req(), ctx("1"));

    expect(readCache).toHaveBeenCalledWith("inv-1-v4-t1");
  });
});
