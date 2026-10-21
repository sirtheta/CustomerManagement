import { test, expect } from "@playwright/test";

// The e2e server runs with DISABLE_EMAIL=true, and the action answers with the
// same generic success for every address, so no mail is sent and no account is touched.
test.describe("Passwort vergessen", () => {
  test("is reachable from the login page without a session and can be submitted", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Passwort vergessen?" }).click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByText("Passwort vergessen", { exact: true })).toBeVisible();

    await page.getByLabel("E-Mail").fill("unknown@example.com");
    await page.getByRole("button", { name: "Link anfordern" }).click();

    await expect(page.getByText("Falls ein Konto mit dieser Adresse existiert")).toBeVisible();
  });

  test("the reset page is reachable without a session", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/reset-password$/);
  });
});
