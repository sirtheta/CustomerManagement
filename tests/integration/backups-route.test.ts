import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));

import { GET } from "@/app/api/backups/[filename]/route";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "test@example.com", role }, expires: "2099-01-01" } as Session;
}

const req = (filename: string) => new NextRequest(`http://localhost/api/backups/${filename}`);
const ctx = (filename: string) => ({ params: Promise.resolve({ filename }) });

let dir: string;
let previousBackupDir: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "customermanagement-backups-route-"));
  writeFileSync(join(dir, "db-2026-09-30.db"), "sqlite bytes");
  previousBackupDir = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = dir;
});

afterAll(() => {
  if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = previousBackupDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/backups/[filename]", () => {
  it("rejects an unauthenticated request", async () => {
    currentSession = null;
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin", async () => {
    currentSession = sessionFor("Editor");
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(403);
  });

  it("streams a backup for an admin", async () => {
    currentSession = sessionFor("Admin");
    const res = await GET(req("db-2026-09-30.db"), ctx("db-2026-09-30.db"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
    expect(res.headers.get("Content-Disposition")).toContain("db-2026-09-30.db");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("sqlite bytes");
  });

  it("returns 404 for a backup that does not exist", async () => {
    currentSession = sessionFor("Admin");
    const res = await GET(req("db-2020-01-01.db"), ctx("db-2020-01-01.db"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a filename outside the exact backup shape", async () => {
    currentSession = sessionFor("Admin");
    for (const name of ["../../.env", "..%2F..%2F.env", "db-2026-09-30.db.tmp", "customermanagement.db"]) {
      const res = await GET(req(name), ctx(name));
      expect(res.status).toBe(404);
    }
  });
});
