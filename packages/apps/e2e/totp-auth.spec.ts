import { expect, test } from "@playwright/test";

test.describe("TOTP sign-in stories", () => {
  test("authenticator field accepts a password-manager code", async ({ page }) => {
    await page.goto("/iframe.html?id=themes-login-two-factor--authenticator-code&viewMode=story");
    const otp = page.getByLabel("Authentication code");
    await expect(otp).toBeVisible({ timeout: 30_000 });
    await expect(otp).toHaveAttribute("autocomplete", "one-time-code");
    await expect(otp).toHaveAttribute("inputmode", "numeric");
    await expect(page.locator('input[name="username"]')).toHaveAttribute(
      "autocomplete",
      "username",
    );
    await otp.evaluate((input) => {
      const data = new DataTransfer();
      data.setData("text/plain", "123 456");
      input.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
      );
    });
    await expect(otp).toHaveValue("123456");
  });

  test("replace mode asks for a new authenticator", async ({ page }) => {
    await page.goto("/iframe.html?id=themes-login-two-factor--replace&viewMode=story");
    await expect(page.getByRole("heading", { name: "Set up a new authenticator" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("a required session shows setup and log out", async ({ page }) => {
    await page.goto("/iframe.html?id=themes-login-two-factor--session-forced-setup&viewMode=story");
    await expect(
      page.getByRole("heading", { name: "Set up two-factor authentication" }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel("Password").fill("secret");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("link", { name: "Settings → Security" })).toBeVisible();
  });
});
