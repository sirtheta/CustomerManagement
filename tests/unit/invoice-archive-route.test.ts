import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock("@/lib/prisma", () => ({
  default: { sentDocument: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { GET } from "@/app/api/invoices/[id]/archive/[docId]/route";
import prisma from "@/lib/prisma";
import { archivePdf } from "@/lib/document-archive";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "t@example.com", role }, expires: "2099-01-01" } as Session;
}
const req = () => new NextRequest("http://localhost/api/invoices/1/archive/5");
const ctx = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });

const pdf = Buffer.from("%PDF-1.4 route bytes");
let dir: string;
let row: { id: number; invoiceId: number; kind: string; documentNumber: string; path: string; sha256: string; size: number; createdAt: Date };

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "route-archive-"));
  process.env.ARCHIVE_DIR = dir;
  currentSession = sessionFor("Editor");
  const a = await archivePdf({ documentNumber: "I-26090001", kind: "Invoice", pdf });
  row = { id: 5, invoiceId: 1, kind: "Invoice", documentNumber: "I-26090001", createdAt: new Date(2026, 8, 30), ...a };
  vi.mocked(prisma.sentDocument.findFirst).mockResolvedValue(row as never);
});

afterEach(() => {
  delete process.env.ARCHIVE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/invoices/[id]/archive/[docId]", () => {
  it("rejects an unauthenticated request", async () => {
    currentSession = null;
    expect((await GET(req(), ctx("1", "5"))).status).toBe(401);
  });

  it("rejects a viewer", async () => {
    currentSession = sessionFor("Viewer");
    expect((await GET(req(), ctx("1", "5"))).status).toBe(403);
  });

  it("rejects non-numeric ids", async () => {
    expect((await GET(req(), ctx("x", "5"))).status).toBe(400);
    expect((await GET(req(), ctx("1", "y"))).status).toBe(400);
  });

  it("looks the document up by both ids so a foreign docId gives 404", async () => {
    vi.mocked(prisma.sentDocument.findFirst).mockResolvedValue(null);
    const res = await GET(req(), ctx("2", "5"));
    expect(res.status).toBe(404);
    expect(prisma.sentDocument.findFirst).toHaveBeenCalledWith({ where: { id: 5, invoiceId: 2 } });
  });

  it("serves the verified PDF to an editor", async () => {
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toContain("I-26090001_Invoice_2026-09-30.pdf");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pdf);
  });

  it("serves the PDF to an admin", async () => {
    currentSession = sessionFor("Admin");
    expect((await GET(req(), ctx("1", "5"))).status).toBe(200);
  });

  it("answers 409 when the archived file was changed", async () => {
    chmodSync(join(dir, row.path), 0o644);
    writeFileSync(join(dir, row.path), "tampered");
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Prüfsumme");
  });

  it("answers 409 when the archived file is missing", async () => {
    rmSync(join(dir, row.path));
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("fehlt");
  });
});
