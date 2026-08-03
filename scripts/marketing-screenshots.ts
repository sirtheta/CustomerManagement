/**
 * Captures marketing screenshots of the app against an isolated, seeded
 * e2e database — never touches real customer data.
 *
 * Usage:
 *   npx tsx scripts/marketing-screenshots.ts
 *
 * Boots its own `next dev` server (same recipe as playwright.config.ts /
 * `npm run test:e2e:server`) against a throwaway SQLite DB under
 * data-marketing/, logs in as the seeded admin, walks a fixed list of
 * routes, and writes PNGs to marketing/screenshots/.
 *
 * Re-run any time the UI changes to refresh the screenshots used on
 * https://nemicomp.ch/customer-management/ (see marketing/README.md and
 * scripts/generate-marketing-html.ts for the next step).
 */
import { chromium, type Page } from "@playwright/test";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import path from "path";

const PORT = process.env.MARKETING_PORT ?? "3101";
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data-marketing", "marketing.db");
const OUT_DIR = path.join(ROOT, "marketing", "screenshots");

const ADMIN_EMAIL = "admin@marketing.local";
const ADMIN_PASSWORD = "marketing-admin-password";

const VIEWPORT = { width: 1600, height: 1000 };

type Shot = {
  name: string;
  path: string;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  waitFor?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  { name: "dashboard", path: "/dashboard" },
  { name: "customers", path: "/customers" },
  { name: "invoices-overview", path: "/invoices" },
  {
    name: "invoice-new",
    path: "/invoices/new",
    fullPage: true,
  },
  { name: "analytics", path: "/analytics" },
  { name: "accounting", path: "/accounting" },
  {
    name: "settings-design",
    path: "/settings/design",
    // The right-hand live PDF preview is a blob:// iframe, which Chromium's
    // PDF viewer doesn't reliably render in Playwright (same limitation as
    // the top-level invoice PDF — see renderPdfPage) — it just stays blank.
    // Crop to the left settings column instead of showing empty whitespace.
    clip: { x: 0, y: 0, width: 1010, height: 1000 },
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
            `Port ${port} is already in use — a previous marketing-screenshots.ts run may still be alive. ` +
              `Check for a stray "next dev" process before retrying (see incident note in this file's history).`,
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
    AUTH_SECRET: "marketing-screenshot-secret-not-used-in-prod-32",
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    DISABLE_EMAIL: "true",
    DISABLE_TELEGRAM: "true",
  };

  // Build the command as a single string with the port inlined (rather than
  // relying on `npm run test:e2e:server`'s `-p $PORT`, which is bash syntax
  // and doesn't expand under Windows' cmd.exe).
  const child = spawn(
    `npx prisma migrate deploy && npx tsx prisma/seed.ts && npx next dev -p ${PORT}`,
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
      shell: true,
    },
  );

  try {
    await waitForServer(BASE_URL);
  } catch (err) {
    // Startup failed (e.g. Turbopack never finished compiling) — kill the
    // process tree we just spawned instead of leaking it. A previous bug
    // here left an orphaned `next dev` running unsupervised, whose Turbopack
    // workers piled up into thousands of node.exe processes over time.
    stopServer(child);
    throw err;
  }
  return child;
}

// Chromium's built-in PDF viewer isn't reliably available in Playwright's
// bundled browser (top-level goto()s to a PDF download instead of render,
// and an <iframe> embed just stays blank), so instead of screenshotting a
// browser tab, fetch the PDF bytes and rasterize via scripts/render-pdf-page.ts
// — a separate process, because calling pdfjs-dist's getDocument() twice in
// this same process (which also has a live Playwright browser) intermittently
// throws a DataCloneError from its internal fake-worker message port.
function renderPdfPage(
  pdfPath: string,
  pageNumber: number,
  outPath: string,
  cropBottomFraction?: number,
): number {
  const args = ["tsx", "scripts/render-pdf-page.ts", pdfPath, String(pageNumber), outPath, "2"];
  if (cropBottomFraction) args.push(String(cropBottomFraction));
  const output = execFileSync("npx", args, { cwd: ROOT, encoding: "utf8", shell: true });
  const match = output.match(/RESULT (\{.*\})/);
  if (!match) throw new Error(`render-pdf-page.ts produced no RESULT line:\n${output}`);
  return (JSON.parse(match[1]) as { numPages: number }).numPages;
}

// Hides the Next.js dev-mode indicator badge (<nextjs-portal>, bottom-left
// "N" bubble) so it never shows up in the marketing screenshots. Setting an
// inline !important style beats Next's own injected stylesheet reliably —
// a plain <style> tag injected via addInitScript loses that cascade fight
// because Next's own dev-overlay styles are inserted later in the document
// and tie-break on source order when both sides use !important.
async function hideDevIndicator(page: Page) {
  await page
    .locator("nextjs-portal")
    .evaluateAll((els) => els.forEach((el) => (el as HTMLElement).style.setProperty("display", "none", "important")))
    .catch(() => {});
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("E-Mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Passwort", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("Starting isolated marketing server...");
  const server = await startServer();

  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: "light",
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    console.log("Logging in as seeded admin...");
    await login(page);

    for (const shot of SHOTS) {
      console.log(`Capturing ${shot.name} (${shot.path})...`);
      await page.goto(`${BASE_URL}${shot.path}`);
      await page.waitForLoadState("networkidle");
      if (shot.waitFor) await shot.waitFor(page);
      await hideDevIndicator(page);
      await page.screenshot({
        path: path.join(OUT_DIR, `${shot.name}.png`),
        fullPage: shot.fullPage ?? false,
        clip: shot.clip,
      });
    }

    // Bonus: a real generated invoice PDF (Swiss QR bill), rendered via
    // Chromium's built-in PDF viewer so the screenshot shows the actual
    // typeset document, not the app UI.
    await page.goto(`${BASE_URL}/invoices`);
    // Invoice ids are plain integers, so filter out static routes like
    // /invoices/new, /invoices/templates, /invoices/pending, /invoices/reminders.
    const invoiceHrefs = await page.locator('a[href^="/invoices/"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    const firstInvoiceHref = invoiceHrefs.find((href) => href && /^\/invoices\/\d+$/.test(href)) ?? null;
    if (firstInvoiceHref) {
      const invoiceId = firstInvoiceHref.split("/").filter(Boolean).pop();
      console.log(`Capturing invoice PDF for invoice ${invoiceId}...`);
      const cookieHeader = (await context.cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      const pdfRes = await fetch(`${BASE_URL}/api/invoices/${invoiceId}/pdf`, {
        headers: { cookie: cookieHeader },
      });
      if (!pdfRes.ok) {
        throw new Error(`Failed to fetch invoice PDF: ${pdfRes.status} ${pdfRes.statusText}`);
      }
      const pdfPath = path.join(OUT_DIR, "_invoice.pdf");
      writeFileSync(pdfPath, Buffer.from(await pdfRes.arrayBuffer()));
      const numPages = renderPdfPage(pdfPath, 1, path.join(OUT_DIR, "invoice-pdf.png"));
      // swissqrbill appends the Swiss QR payment slip as its own page.
      if (numPages >= 2) {
        // ~105mm of an A4 page (297mm) is the fixed Swiss QR-bill slip height.
        renderPdfPage(pdfPath, numPages, path.join(OUT_DIR, "invoice-pdf-qr.png"), 105 / 297);
      }
      rmSync(pdfPath, { force: true });
    } else {
      console.warn("No invoice found to screenshot a PDF for — skipping invoice-pdf.png");
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
