import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";

const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://localhost:${PORT}`;

// Isolated SQLite DB for e2e runs so tests never touch the developer's
// local dev data. Seeded via prisma/seed.ts on webServer startup
// (idempotent — re-running the server won't duplicate data).
const dbPath = path.join(__dirname, "data-e2e", "e2e.db");

// Some sandboxed environments pre-install a chromium build under a fixed
// path instead of the revision @playwright/test would normally download.
// Use it when present; otherwise fall back to Playwright's own management
// (requires `npx playwright install chromium` once).
const sandboxChromium = "/opt/pw-browsers/chromium";
const chromiumExecutablePath = existsSync(sandboxChromium) ? sandboxChromium : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run test:e2e:server",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: `file:${dbPath}`,
      PORT,
      // NextAuth's dev-mode secret auto-generation doesn't reliably kick in
      // for a `next dev` instance spawned headlessly by Playwright, so set
      // one explicitly. This DB is local/ephemeral — no real secrets at risk.
      AUTH_SECRET: "e2e-test-secret-not-used-in-production-32chars",
      ADMIN_EMAIL: "admin@e2e.local",
      ADMIN_PASSWORD: "e2e-admin-password",
      DISABLE_EMAIL: "true",
      DISABLE_TELEGRAM: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath && {
          launchOptions: { executablePath: chromiumExecutablePath },
        }),
      },
    },
  ],
});
