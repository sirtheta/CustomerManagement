import fs from "fs";
import { SESSION_EXPIRED_PATH } from "@/lib/session-expired";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// proxy.ts only checks that a session cookie exists and app/(app)/layout.tsx is
// the only redirect for a missing session. Next.js may render a page without
// re-running the layout (RSC partial rendering), so every page must verify the
// session itself — before it reads any data.

const touched = vi.hoisted(() => ({ prisma: [] as string[] }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get(_t, prop) {
        touched.prisma.push(String(prop));
        throw new Error(`prisma.${String(prop)} used without a session`);
      },
    }
  ),
}));

const appDir = path.resolve(__dirname, "../../app/(app)");
const pages = (fs.readdirSync(appDir, { recursive: true }) as string[])
  .map((f) => f.split(path.sep).join("/"))
  .filter((f) => f.endsWith("/page.tsx") || f === "page.tsx")
  .sort();

const props = {
  params: Promise.resolve({ id: "1", customerId: "1" }),
  searchParams: Promise.resolve({}),
};

describe("pages under app/(app) require a session themselves", () => {
  beforeEach(() => {
    touched.prisma.length = 0;
  });

  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it.each(pages)("%s redirects to the session-expired route without a session", async (file) => {
    const mod = (await import(/* @vite-ignore */ `@/app/(app)/${file}`)) as { default: (p: typeof props) => Promise<unknown> };
    await expect(mod.default(props)).rejects.toThrow(`NEXT_REDIRECT:${SESSION_EXPIRED_PATH}`);
    expect(touched.prisma).toEqual([]);
  });
});
