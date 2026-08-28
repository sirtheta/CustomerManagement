import { test, expect } from "@playwright/test";

// Credentials come from prisma/seed.ts, which the webServer seeds into the
// isolated e2e DB before these tests run (see playwright.config.ts).
const EDITOR_EMAIL = "editor@example.com";
const EDITOR_PASSWORD = "admin123";

test.describe("Login", () => {
  test("shows an error for wrong credentials", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("E-Mail").fill(EDITOR_EMAIL);
    await page.getByLabel("Passwort", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Weiter" }).click();

    await expect(page.getByText("Ungültige Anmeldedaten.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs in a user without 2FA and redirects to the dashboard", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("E-Mail").fill(EDITOR_EMAIL);
    await page.getByLabel("Passwort", { exact: true }).fill(EDITOR_PASSWORD);
    await page.getByRole("button", { name: "Weiter" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
