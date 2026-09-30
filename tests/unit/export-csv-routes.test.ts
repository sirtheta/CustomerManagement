import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/journal")>()),
  fetchJournal: vi.fn(async () => []),
}));
vi.mock("@/lib/receivables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/receivables")>();
  return { ...actual, fetchReceivables: vi.fn(async (_prisma, asOf: Date) => actual.buildReceivables([], asOf)) };
});

import { GET as accountingGET } from "@/app/api/export/accounting/route";
import { GET as receivablesGET } from "@/app/api/export/receivables/route";
import { fetchJournal } from "@/lib/journal";

const session = (role: "Admin" | "Editor" | "Viewer") =>
  ({ user: { id: "1", name: "Test", email: "t@example.com", role }, expires: "2099-01-01" }) as Session;

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = session("Editor");
});

describe("CSV export routes (regression)", () => {
  it("accounting export uses the journal columns and the requested year", async () => {
    const res = await accountingGET(new Request("http://localhost/api/export/accounting?year=2025"));
    expect(await res.text()).toBe("Datum,Beleg-Nr.,Typ,Kunde,Kategorie,Text,Betrag (CHF)");
    expect(vi.mocked(fetchJournal).mock.calls[0][1]).toBe(2025);
  });

  it("receivables export has the address columns", async () => {
    const res = await receivablesGET(new Request("http://localhost/api/export/receivables?asOf=2026-12-31"));
    expect(await res.text()).toBe(
      "Rechnung,Kunde,Strasse,PLZ,Ort,Land,Rechnungsdatum,Fällig,Total (CHF),Bezahlt (CHF),Offen (CHF),Guthaben (CHF),Alter"
    );
    expect(res.headers.get("Content-Disposition")).toContain("offene-posten-2026-12-31.csv");
  });

  it("still redirects a viewer", async () => {
    currentSession = session("Viewer");
    await expect(accountingGET(new Request("http://localhost/api/export/accounting"))).rejects.toThrow("REDIRECT:/dashboard");
    await expect(receivablesGET(new Request("http://localhost/api/export/receivables"))).rejects.toThrow("REDIRECT:/dashboard");
  });
});
