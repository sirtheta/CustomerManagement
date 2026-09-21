/**
 * Captures the screenshots embedded in public/benutzerhandbuch.html.
 *
 * Boots its own `next dev` server (same recipe as scripts/marketing-screenshots.ts)
 * against a throwaway SQLite DB under data-manual/, seeded by
 * scripts/seed-manual-demo.ts (fixed, fictional data — never real customer data).
 *
 * Usage:
 *   npx tsx scripts/manual-screenshots.ts [names...]
 *   (omit names to capture everything; pass e.g. "dashboard invoices"
 *   to only regenerate specific shots — see the `SHOTS` list below for names)
 *
 * Then splice the PNGs in scripts/.manual-shots/ back into the manual (as
 * inline SVG-replacing <img> tags) with scripts/splice-manual-screenshots.ts.
 *
 * Demo accounts: admin@demo.local / editor@demo.local / viewer@demo.local,
 * password Demo1234! (see scripts/seed-manual-demo.ts for the full roster).
 *
 * Re-run after significant UI changes rather than hand-editing stale
 * screenshots into the manual.
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { createServer } from "net";
import path from "path";

const PORT = process.env.MANUAL_PORT ?? "3102";
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data-manual", "manual.db");
const OUT_DIR = path.join(__dirname, ".manual-shots");

const ADMIN = { email: "admin@demo.local", password: "Demo1234!" };

const VIEWPORT = { width: 1440, height: 900 };

type Shot = {
  name: string;
  path: string;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  run?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  { name: "login", path: "/login", fullPage: false },
  { name: "profile", path: "/profile" },
  { name: "dashboard", path: "/dashboard", fullPage: true },
  { name: "customers", path: "/customers", fullPage: true },
  { name: "invoices", path: "/invoices", fullPage: true },
  { name: "invoice-new", path: "/invoices/new", fullPage: true },
  { name: "quotes", path: "/quotes", fullPage: true },
  { name: "services", path: "/services", fullPage: true },
  { name: "analytics", path: "/analytics", fullPage: true },
  { name: "accounting", path: "/accounting", fullPage: true },
  { name: "settings", path: "/settings", fullPage: true },
  {
    name: "settings-design",
    path: "/settings/design",
    // The right-hand live PDF preview is a blob:// iframe, which Chromium's
    // PDF viewer doesn't reliably render in Playwright — it just stays
    // blank (same limitation noted in marketing-screenshots.ts). Crop to
    // the left settings column instead of showing empty whitespace.
    clip: { x: 0, y: 0, width: 1010, height: 900 },
  },
  { name: "settings-categories", path: "/settings/categories", fullPage: true },
  { name: "settings-users", path: "/settings/users", fullPage: true },
  { name: "settings-audit", path: "/settings/audit", fullPage: true },
  { name: "settings-logs", path: "/settings/logs", fullPage: true },
  {
    name: "two-factor-dialog",
    path: "/settings/users",
    run: async (page) => {
      await page.goto(`${BASE_URL}/settings/users`);
      await page.waitForSelector("text=Benutzerverwaltung");
      await page
        .locator("tr", { hasText: "Matteo Rossi" })
        .getByRole("button", { name: "2FA einrichten" })
        .click();
      await page.getByRole("button", { name: "QR-Code generieren" }).click();
      await page.waitForSelector("text=Bestätigen");
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT_DIR, "two-factor-dialog.png") });
    },
  },
];

function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status === 307 || res.status === 302) {
          resolve();
          return;
        }
      } catch {
        // server not up yet
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server at ${url} did not respond within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function stopServer(child: ChildProcess) {
  // shell:true spawns cmd.exe, whose child (next dev) survives a plain
  // kill() of the top process on Windows — take out the whole tree instead.
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill();
  }
}

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = createServer()
      .once("error", () =>
        reject(
          new Error(
            `Port ${port} is already in use — a previous manual-screenshots.ts run may still be alive. ` +
              `Check for a stray "next dev" process before retrying.`,
          ),
        ),
      )
      .once("listening", () => tester.close(() => resolve()))
      .listen(port, "127.0.0.1");
  });
}

async function startServer(): Promise<ChildProcess> {
  await assertPortFree(Number(PORT));
  rmSync(path.dirname(DB_PATH), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const env = {
    ...process.env,
    DATABASE_URL: `file:${DB_PATH}`,
    PORT,
    AUTH_SECRET: "manual-screenshot-secret-not-used-in-prod-32ch",
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    DISABLE_EMAIL: "true",
    DISABLE_TELEGRAM: "true",
  };

  const child = spawn(
    `npx prisma migrate deploy && npx tsx scripts/seed-manual-demo.ts && npx next dev -p ${PORT}`,
    { cwd: ROOT, env, stdio: "inherit", shell: true },
  );

  try {
    await waitForServer(BASE_URL);
  } catch (err) {
    stopServer(child);
    throw err;
  }
  return child;
}

// Hides the Next.js dev-mode indicator badge so it never shows up in the
// manual screenshots — see hideDevIndicator in marketing-screenshots.ts.
async function hideDevIndicator(page: Page) {
  await page
    .locator("nextjs-portal")
    .evaluateAll((els) => els.forEach((el) => (el as HTMLElement).style.setProperty("display", "none", "important")))
    .catch(() => {});
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("E-Mail").fill(ADMIN.email);
  await page.getByLabel("Passwort", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function main() {
  const requested = process.argv.slice(2);
  const selected = requested.length ? SHOTS.filter((s) => requested.includes(s.name)) : SHOTS;
  if (selected.length === 0) {
    console.error("No matching shots. Known names:", SHOTS.map((s) => s.name).join(", "));
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Starting isolated manual server...");
  const server = await startServer();

  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light", deviceScaleFactor: 2 });
    const page = await context.newPage();

    // Capture the logged-out /login shot first, before authenticating —
    // once logged in, /login just redirects straight to the dashboard.
    const loginShot = selected.find((s) => s.name === "login");
    if (loginShot) {
      console.log(`Capturing ${loginShot.name} (${loginShot.path})...`);
      await page.goto(`${BASE_URL}${loginShot.path}`);
      await page.waitForLoadState("networkidle");
      await hideDevIndicator(page);
      await page.screenshot({ path: path.join(OUT_DIR, "login.png"), fullPage: loginShot.fullPage ?? false });
    }

    const remaining = selected.filter((s) => s.name !== "login");
    if (remaining.length > 0) {
      console.log("Logging in as seeded admin...");
      await login(page);

      for (const shot of remaining) {
        console.log(`Capturing ${shot.name} (${shot.path})...`);
        try {
          if (shot.run) {
            await shot.run(page);
          } else {
            await page.goto(`${BASE_URL}${shot.path}`);
            await page.waitForLoadState("networkidle");
            await hideDevIndicator(page);
            await page.screenshot({
              path: path.join(OUT_DIR, `${shot.name}.png`),
              fullPage: shot.fullPage ?? false,
              clip: shot.clip,
            });
          }
        } catch (err) {
          console.error(`failed: ${shot.name}`, err);
        }
      }
    }

    await browser.close();
    console.log(`Done. Screenshots written to ${OUT_DIR}`);
  } finally {
    stopServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
