import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirst, redirect } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({ default: { applicationSettings: { findFirst } } }));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => vi.clearAllMocks());

// tests/setup.ts replaces the guard with a no-op for all other tests
async function guard() {
  return vi.importActual<typeof import("@/lib/module-guard")>("@/lib/module-guard");
}

describe("requireModule", () => {
  it("lets an enabled module through", async () => {
    findFirst.mockResolvedValue({ moduleQuotes: true });
    await expect((await guard()).requireModule("quotes")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a switched-off module to the dashboard", async () => {
    findFirst.mockResolvedValue({ moduleQuotes: false });
    await expect((await guard()).requireModule("quotes")).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});

describe("moduleDisabledResponse", () => {
  it("is null while the module is on and a 404 once it is off", async () => {
    const { moduleDisabledResponse } = await guard();

    findFirst.mockResolvedValue({ moduleAccounting: true });
    expect(await moduleDisabledResponse("accounting")).toBeNull();

    findFirst.mockResolvedValue({ moduleAccounting: false });
    expect((await moduleDisabledResponse("accounting"))?.status).toBe(404);
  });
});
