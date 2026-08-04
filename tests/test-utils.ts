import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { existsSync, unlinkSync } from "fs";
import { beforeAll, afterAll, beforeEach } from "vitest";

type TestPrisma = ReturnType<typeof createPrismaClient>;

function createPrismaClient(dbPath: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter }) as unknown as PrismaClient;
}

/**
 * Registers beforeAll/beforeEach/afterAll hooks that create and teardown
 * a temporary SQLite database for a test suite. Call at describe-level and
 * access `db.prisma` inside each it() block.
 *
 * Equivalent to TestBase.cs with per-suite SQLite isolation.
 */
export function createTestDatabase() {
  const rawPath = join(tmpdir(), `test-${randomUUID()}.db`);
  // Prisma CLI expects forward slashes even on Windows
  const dbPath = rawPath.replace(/\\/g, "/");
  const dbUrl = `file:${dbPath}`;
  const projectRoot = process.cwd();

  const state: { prisma: TestPrisma } = {} as { prisma: TestPrisma };

  beforeAll(() => {
    // Fresh temp file → no --force-reset needed (nothing to drop).
    // PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION satisfies Prisma's AI-safety
    // guard in case it triggers for push as well.
    execSync("npx prisma db push", {
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
      },
      cwd: projectRoot,
    });
    state.prisma = createPrismaClient(dbPath);
  }, 30_000);

  beforeEach(async () => {
    const p = state.prisma;
    // Delete in FK-safe order (children before parents)
    await p.auditLog.deleteMany();
    await p.invoiceSentLog.deleteMany();
    await p.pendingReminder.deleteMany();
    await p.item.deleteMany();
    await p.pendingEmail.deleteMany();
    await p.invoice.deleteMany();
    await p.quote.deleteMany();
    await p.document.deleteMany();
    await p.service.deleteMany();
    await p.customer.deleteMany();
    await p.expense.deleteMany();
    await p.category.deleteMany();
    await p.applicationSettings.deleteMany();
    await p.companyInformation.deleteMany();
    await p.passwordResetToken.deleteMany();
    await p.user.deleteMany();
  });

  afterAll(async () => {
    await state.prisma.$disconnect();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  });

  return state;
}

// ── Fixture helpers – equivalent to C# TestBase factory methods ──────────────

export function createValidTestCustomer() {
  return {
    contactPerson: "Test Person",
    company: "Client AG",
    address: "Seestrasse 100",
    zipCode: "8002",
    city: "Zürich",
    email: "jane@clientag.ch",
    phone: "+41 44 987 65 43",
    yearlyInvoice: false,
    contactInsteadOfCompany: false,
  };
}

export function createTestCategory() {
  return { name: "Test", isActive: true };
}

export function createValidItemList() {
  return [
    {
      name: "Item 1",
      quantity: 2,
      unitPrice: 100,
      totalAmount: 200,
      unit: "Piece" as const,
      description: "Test Item 1",
    },
    {
      name: "Item 2",
      quantity: 1,
      unitPrice: 50,
      totalAmount: 50,
      unit: "Piece" as const,
      description: "Test Item 2",
    },
  ];
}
