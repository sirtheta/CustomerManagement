import { vi } from "vitest";

// Prevent Next.js "use server" / "use client" from being processed
// These directives are string literals in Node.js/Vitest – they're harmless no-ops.

// Isolate the global prisma singleton between unit tests that mock it.
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { default: new PrismaClient() };
});
