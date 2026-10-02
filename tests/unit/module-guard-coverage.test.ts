import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MODULE_KEYS, type ModuleKey } from "@/lib/modules";

// Static check that the module switches are wired into every entry point of a
// module: Server Actions and pages call requireModule("<key>"), API routes call
// moduleDisabledResponse("<key>"). tests/setup.ts stubs the guard, so a missing
// call would otherwise go unnoticed. The runtime behaviour is covered by
// tests/integration/module-guard-wiring.test.ts.
const root = process.cwd();
const app = path.join(root, "app");

/** Paths (relative to app/, forward slashes) that belong to one module. A directory covers everything below it. */
const MODULE_PATHS: Record<ModuleKey, string[]> = {
  tasks: ["(app)/customers/task-actions.ts"],
  subscriptions: ["(app)/subscriptions", "(app)/invoices/pending", "(app)/customers/subscription-actions.ts"],
  quotes: ["(app)/quotes", "api/quotes", "api/export/quotes"],
  reminders: ["(app)/invoices/reminders", "api/reminders"],
  bankImport: ["(app)/invoices/import"],
  accounting: [
    "(app)/accounting",
    "api/expenses",
    "api/export/accounting",
    "api/export/receivables",
    "api/export/year-package",
  ],
  analytics: ["(app)/analytics"],
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(app, file).replace(/\\/g, "/");
const allFiles = walk(app);

function filesOf(key: ModuleKey): string[] {
  return allFiles.filter((file) =>
    MODULE_PATHS[key].some((p) => rel(file) === p || rel(file).startsWith(`${p}/`))
  );
}

const isServerActionFile = (src: string) => /^\s*["']use server["']/.test(src);
const isRoute = (file: string) => path.basename(file) === "route.ts";
const isPage = (file: string) => path.basename(file) === "page.tsx";

/** Exported async functions with their source up to the next top-level export. */
function exportedFunctions(src: string): { name: string; body: string }[] {
  const parts = src.split(/^(?=export\s)/m);
  return parts.flatMap((part) => {
    const m = part.match(/^export\s+(?:default\s+)?async\s+function\s+(\w+)/);
    return m ? [{ name: m[1], body: part }] : [];
  });
}

const guardCall = (fn: "requireModule" | "moduleDisabledResponse", key: ModuleKey) =>
  new RegExp(`\\b${fn}\\(\\s*["']${key}["']\\s*\\)`);

describe("module guard coverage (static)", () => {
  describe.each(MODULE_KEYS.map((key) => [key] as const))("%s", (key) => {
    const files = filesOf(key);

    it("has at least one guarded entry point", () => {
      expect(files.length).toBeGreaterThan(0);
      const sources = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
      expect(sources).toMatch(new RegExp(`(requireModule|moduleDisabledResponse)\\(\\s*["']${key}["']`));
    });

    it("every Server Action calls requireModule", () => {
      const missing: string[] = [];
      for (const file of files) {
        const src = fs.readFileSync(file, "utf8");
        if (!isServerActionFile(src)) continue;
        const fns = exportedFunctions(src);
        if (fns.length === 0) missing.push(`${rel(file)} (no exported actions found)`);
        for (const fn of fns) {
          if (!guardCall("requireModule", key).test(fn.body)) missing.push(`${rel(file)}: ${fn.name}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it("every page calls requireModule", () => {
      const missing = files
        .filter(isPage)
        .filter((file) => !guardCall("requireModule", key).test(fs.readFileSync(file, "utf8")))
        .map(rel);
      expect(missing).toEqual([]);
    });

    it("every API route handler calls moduleDisabledResponse", () => {
      const missing: string[] = [];
      for (const file of files.filter(isRoute)) {
        for (const fn of exportedFunctions(fs.readFileSync(file, "utf8"))) {
          if (!guardCall("moduleDisabledResponse", key).test(fn.body)) missing.push(`${rel(file)}: ${fn.name}`);
        }
      }
      expect(missing).toEqual([]);
    });
  });

  it("every actions file in a module directory is a guarded Server Action file", () => {
    const actionFiles = MODULE_KEYS.flatMap((key) =>
      filesOf(key)
        .filter((f) => /(^|-)actions\.ts$/.test(path.basename(f)))
        .map((f) => ({ key, file: f }))
    );
    expect(actionFiles.length).toBeGreaterThanOrEqual(7);
    for (const { key, file } of actionFiles) {
      const src = fs.readFileSync(file, "utf8");
      expect(isServerActionFile(src), rel(file)).toBe(true);
      expect(src, rel(file)).toMatch(guardCall("requireModule", key));
    }
  });

  it("the module map knows every guard call in app/ (keeps this test current)", () => {
    const unmapped: string[] = [];
    for (const file of allFiles) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b(?:requireModule|moduleDisabledResponse)\(\s*["'](\w+)["']/g)) {
        const key = m[1] as ModuleKey;
        // bookExpenses also needs accounting: an extra check inside another module is fine.
        const owner = MODULE_KEYS.find((k) => filesOf(k).includes(file));
        if (!owner) unmapped.push(`${rel(file)}: ${key}`);
        else if (owner !== key && !(owner === "bankImport" && key === "accounting")) {
          unmapped.push(`${rel(file)}: ${key} (mapped to ${owner})`);
        }
      }
    }
    expect(unmapped).toEqual([]);
  });
});
