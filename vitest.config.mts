import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

// .mts: the package has no "type": "module" (Next.js build), so a .ts config
// with ESM syntax made Vite warn about ESM in a file loaded as CommonJS.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.next/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "app/**/actions.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
  resolve: {
    alias: { "@": path.dirname(fileURLToPath(import.meta.url)) },
  },
});
