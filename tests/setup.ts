import { vi } from "vitest";

// Prevent Next.js "use server" / "use client" from being processed
// These directives are string literals in Node.js/Vitest – they're harmless no-ops.

// Isolate the global prisma singleton between unit tests that mock it. This
// default is never meant to be queried for real — test files either override
// it locally with their own vi.mock, or (dependency-injection pattern) call
// functions with an explicit `prisma` argument and never touch this default
// at all. Prisma 7 requires a driver adapter at construction time even for a
// client nothing will query, so point it at a throwaway in-memory database
// rather than eagerly touching DATABASE_URL / the real dev database file.
// Module switches (Einstellungen → Module) default to "all on" in unit tests,
// so guarded pages and actions need no settings row. Tests of the guard itself
// import the real file with vi.importActual.
vi.mock("@/lib/module-guard", async () => {
  const { allModulesEnabled } = await import("@/lib/modules");
  return {
    loadModules: async () => allModulesEnabled(),
    requireModule: async () => undefined,
    moduleDisabledResponse: async () => null,
  };
});

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  const adapter = new PrismaBetterSqlite3({ url: ":memory:" });
  return { default: new PrismaClient({ adapter }) };
});
