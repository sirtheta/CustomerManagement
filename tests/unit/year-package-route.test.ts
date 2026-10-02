import { describe, it, expect, vi, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { Session } from "next-auth";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/year-package", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/year-package")>()),
  buildYearPackage: vi.fn(async (_prisma, _year, _now, emit) => {
    await emit({ name: "jahrespaket-2026/journal-2026.csv", data: new TextEncoder().encode("Datum") });
    await emit({ name: "jahrespaket-2026/rechnungen/a.pdf", data: new Uint8Array([1, 2, 3]) });
    return { fileCount: 2, pdfOk: 1, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 };
  }),
}));

import { GET } from "@/app/api/export/year-package/route";
import { logAudit } from "@/lib/audit";
import { buildYearPackage } from "@/lib/year-package";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "t@example.com", role }, expires: "2099-01-01" } as Session;
}
const req = (query = "year=2026") => new Request(`http://localhost/api/export/year-package?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = sessionFor("Editor");
});

describe("GET /api/export/year-package", () => {
  it("redirects an unauthenticated request to the login", async () => {
    currentSession = null;
    await expect(GET(req())).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects a viewer to the dashboard", async () => {
    currentSession = sessionFor("Viewer");
    await expect(GET(req())).rejects.toThrow("REDIRECT:/dashboard");
    expect(buildYearPackage).not.toHaveBeenCalled();
  });

  it.each(["", "year=abc", "year=1999", "year=2099"])("answers 400 for %s", async (query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    expect(buildYearPackage).not.toHaveBeenCalled();
  });

  it("streams a zip with the produced files", async () => {
    const res = await GET(req("year=2026"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jahrespaket-2026.zip"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "jahrespaket-2026/journal-2026.csv",
      "jahrespaket-2026/rechnungen/a.pdf",
    ]);
    expect(strFromU8(files["jahrespaket-2026/journal-2026.csv"])).toBe("Datum");
  });

  it("writes an audit entry with the summary", async () => {
    const res = await GET(req("year=2026"));
    await res.arrayBuffer();
    expect(logAudit).toHaveBeenCalledWith(
      currentSession,
      "EXPORT",
      "YearPackage",
      undefined,
      "2026",
      { fileCount: 2, pdfOk: 1, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 }
    );
  });

  it("fails the stream when building the package fails", async () => {
    vi.mocked(buildYearPackage).mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req("year=2026"));
    await expect(res.arrayBuffer()).rejects.toThrow("db down");
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("writes no audit entry when the client aborts the download before the package is finished", async () => {
    vi.mocked(buildYearPackage).mockImplementationOnce(async (_prisma, _year, _now, emit) => {
      await emit({ name: "jahrespaket-2026/journal-2026.csv", data: new TextEncoder().encode("Datum") });
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { fileCount: 1, pdfOk: 0, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 };
    });
    const res = await GET(req("year=2026"));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(logAudit).not.toHaveBeenCalled();
  });
});
